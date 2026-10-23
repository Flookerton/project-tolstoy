# The models

Two models can score a post, and neither one sends anything anywhere.

| | Bundled small model | Optional stronger model |
| --- | --- | --- |
| Name | `minilm-toxic-jigsaw` | `Xenova/toxic-bert` |
| Where it comes from | Inside the extension, in `extension/models/` | Downloaded once from Hugging Face, after you press Download |
| Size on disk | 22,864,976 bytes (21.8 MB) | 110,720,344 bytes (about 106 MB) |
| Quantisation | int8, quantised here | int8, q8 |
| Network needed | None, ever | The one download, then none |
| Licence | Apache-2.0 | Apache-2.0 |

The small model is the one in use unless the stronger one has been downloaded, in
which case the stronger one is. The panel's "Stronger model" card is the only place
the choice is made, and it says which model is doing the reading.

## Why the small one is bundled

The stronger model is a better reader of hostile language, and it stays available for
anyone who wants it. The small one is bundled for two reasons that both come from the
same measurement:

* It needs no download and no network at all, so scoring works out of the box and the
  extension makes no request of any kind unless a person asks for the stronger model.
* It is about eight times faster on this machine. Twenty posts take 162ms on WASM
  against about 1.3 seconds for the stronger model. That is the difference between the
  first timeline of a visit being scored by the model and being scored by the rules
  alone, because a first timeline waits at most 400ms.

The honest trade is recall: on the held-out set the small model catches fewer hostile
posts than the stronger one. Both sets of numbers are in the step report and in
`docs/step-reports/task-05.md`.

## How the small model was made

The source is `minuva/MiniLMv2-toxic-jigsaw` (Apache-2.0). Its model card describes it
as a fine-tune of MiniLMv2-L6-H384, itself distilled from BERT-Large, trained on the
Jigsaw toxic comment challenge data with `unitary/toxic-bert` as the teacher. The
labels are the six Jigsaw ones.

Everything below reproduces `extension/models/minilm-toxic-jigsaw/` from scratch.

```sh
# 1. the source files
curl -LO https://huggingface.co/minuva/MiniLMv2-toxic-jigsaw/resolve/main/config.json
curl -LO https://huggingface.co/minuva/MiniLMv2-toxic-jigsaw/resolve/main/tokenizer.json
curl -LO https://huggingface.co/minuva/MiniLMv2-toxic-jigsaw/resolve/main/tokenizer_config.json
curl -LO https://huggingface.co/minuva/MiniLMv2-toxic-jigsaw/resolve/main/special_tokens_map.json
curl -LO https://huggingface.co/minuva/MiniLMv2-toxic-jigsaw/resolve/main/model_optimized.onnx
```

The last file is 90,884,715 bytes (86.7 MB) in fp32.

```sh
# 2. int8 quantisation
python -m pip install onnxruntime onnx
```

```python
from onnxruntime.quantization import quantize_dynamic, QuantType
import onnx

# The source graph came out of ONNX Runtime's optimiser, whose shape inference does
# not give the quantiser a type for every weight. Naming the default type is the
# documented way through it: without this the run stops with "not implemented" on
# the first weight it cannot type.
quantize_dynamic("model_optimized.onnx", "onnx/model_quantized.onnx",
                 weight_type=QuantType.QInt8,
                 extra_options={"DefaultTensorType": onnx.TensorProto.FLOAT})
```

```sh
# 3. the layout the runtime reads
extension/models/minilm-toxic-jigsaw/
  config.json
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  onnx/model_quantized.onnx
  LICENSE.txt
```

The script that did all of this in one go is `tolstoy-tools/export-minilm.py`.

`minuva/MiniLMv2-toxic-jigsaw-onnx` also exists, with a pre-quantised file, but it sits
at the repository root under the name `model_optimized_quantized.onnx`. It does not fit
the `onnx/model_quantized.onnx` path the runtime looks in, so the file here was
quantised from the fp32 graph instead, to keep both the name and the path the runtime
expects.

### What the file is, exactly

* Path in the extension: `extension/models/minilm-toxic-jigsaw/onnx/model_quantized.onnx`
* Size: 22,864,976 bytes
* sha256: `cc79095ae612612e3006fae67def8137f520459d17e5b5b2b843ccc1716e1741`
* Read with: `local_files_only: true` from `chrome.runtime.getURL("models/")`, so it
  cannot reach for anything else even by accident.

## The labels, and what the reader is told

Both models carry the same six labels, and the same four are used:

| Label | Used | Reason shown |
| --- | --- | --- |
| `insult` | yes | Insults someone |
| `threat` | yes | Threatens harm |
| `identity_hate` | yes | Attacks people for who they are |
| `severe_toxic` | yes | Severely hostile |
| `toxic` | no | (a post is not moved for swearing alone) |
| `obscene` | no | (a post is not moved for swearing alone) |

Whichever label produced the score is the reason shown first, and a post is never left
without a reason: when there is nothing to name, the reader is told "Hostile tone." The
mapping lives in one place, `modelReason` in `extension/offscreen/offscreen.js`, so the
two models cannot drift apart in what they say.

## Speed on this machine, warm, WASM

| | 20 posts, one call | ten calls of two posts |
| --- | --- | --- |
| `minilm-toxic-jigsaw` | 162ms | 160ms |
| `Xenova/toxic-bert` | about 1,270ms | about 1,300ms |

## Calibration

`max(rules score, model score * calibration)` decides whether a post moves. The
calibration for each model was chosen from that model's own measured scores on the main
eval set, and from nothing else:

* `minilm-toxic-jigsaw`: **0.8**, the largest value that meets both bars.
  At 0.8: Balanced flags 1 of 77 calm and catches 62 of 66 heated (94%); Calm flags 1 of
  77 calm and catches 64 of 66 heated (97%).
* `Xenova/toxic-bert`: **1**, the largest value that meets both bars.

The measured scores are committed at `tests/fixtures/model-scores-main-minilm.json` and
`tests/fixtures/model-scores-main.json`, so both choices can be checked rather than
taken on trust. The worker reports the figure for whichever model is in use, and the
page reads it from there.

On the main eval set the bundled model rescues none of the heated posts the rules alone
miss, and on the held-out set it catches 4 of 16 heated posts against 9 of 16 for the
stronger model. The rules carry most of the work; the model earns its place on language
the rules were never written for, which is what the held-out set measures. This is
stated plainly rather than hidden behind the bars, because the bars are met by the
rules alone.