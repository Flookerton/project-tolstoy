# Vendored files

These files are copied here so Tolstoy never loads code from the internet.
They are the only third-party code in the extension, and they are pinned.

@huggingface/transformers 4.3.1 (Apache-2.0)  https://github.com/huggingface/transformers.js
onnxruntime-web 1.31.0-dev.20260914-8d85527a0 (MIT)                           https://github.com/microsoft/onnxruntime

- transformers.js  586230 bytes  <- node_modules/@huggingface/transformers/dist/transformers.min.js
- ort-wasm-simd-threaded.asyncify.mjs  53057 bytes  <- node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs
- ort-wasm-simd-threaded.asyncify.wasm  26861777 bytes  <- node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm
- LICENSE-transformers.txt  11358 bytes  <- node_modules/@huggingface/transformers/LICENSE
- LICENSE-onnxruntime-web.txt  1073 bytes  <- ort-LICENSE.txt
