// Sample content for Tolstoy Home.
// All people and posts are fictional. No real accounts, no brand names.

const SAMPLE_POSTS = [
  // Lead story (Moving)
  {
    section: "Moving",
    source: "Saved from a neighborhood thread",
    author: "Lena Marquez",
    handle: "@lena_mends",
    text: "The kid on the corner left his bike out in the rain again. I dried it off, oiled the chain, and tightened the brakes. Left a note saying a friend had tuned it up. This morning I saw him ride past, grinning, and yelling to his mom that his bike got faster overnight.",
    reason: "You saved this"
  },
  // Moving
  {
    section: "Moving",
    source: "Saved from a reading circle",
    author: "Tomoko Hale",
    handle: "@tomoko_writes",
    text: "Found my grandmother's recipe card in a box from the attic. Her handwriting at the bottom: 'Add a little extra butter when someone is sad.' I have made it three times this week.",
    reason: "You liked this"
  },
  {
    section: "Moving",
    source: "Saved from a community board",
    author: "Priya Sondhi",
    handle: "@priya_noticed",
    text: "Someone left a bouquet of wildflowers on the bench by the bus stop with a card that just said 'for whoever needs a good day.' I almost cried. I think the person next to me almost did too.",
    reason: "You liked this"
  },
  {
    section: "Moving",
    source: "Saved from a local group",
    author: "Dexter Walsh",
    handle: "@dext_returns",
    text: "Found a wallet on the trail with sixty dollars and a library card inside. Tracked down the owner through the library and met her at the coffee shop. She offered me half the cash. I told her the look on her face was already more than enough.",
    reason: "You saved this"
  },
  // Funny
  {
    section: "Funny",
    source: "Saved from a family chat",
    author: "Wren Acosta",
    handle: "@wren_says",
    text: "My four-year-old asked why the moon doesn't fall down. I said gravity holds it gently. She said the moon is like a cat being held by a giant. Now every night she says goodnight to the giant.",
    reason: "You liked this"
  },
  {
    section: "Funny",
    source: "Saved from a dog forum",
    author: "Marcus Bell",
    handle: "@marcus_bell",
    text: "My dog stole one sock from the laundry and carried it around the house like a trophy for an hour. When I tried to take it back, he ran in a victory lap around the couch. I have never felt more defeated or more delighted.",
    reason: "You liked this"
  },
  {
    section: "Funny",
    source: "Saved from a community thread",
    author: "Sage Okoro",
    handle: "@sage_texted",
    text: "I texted the wrong number asking if they wanted lasagna for dinner. A stranger said yes. They showed up, we ate, and now every Thursday we cook together. I still do not know their actual name. We call each other Lasagna.",
    reason: "You saved this"
  },
  // Curious
  {
    section: "Curious",
    source: "Saved from a learning thread",
    author: "Niko Vasquez",
    handle: "@niko_learns",
    text: "A child at the park asked me why puddles reflect the sky. I said the water acts like a mirror. She said the puddle is showing the sky its own face. I have not stopped thinking about that since.",
    reason: "You liked this"
  },
  {
    section: "Curious",
    source: "Saved from a nature group",
    author: "Ruth Calderon",
    handle: "@ruth_ponders",
    text: "I looked closely at a puddle today and found a whole world in it. Tadpoles, a water strider, reflected clouds. It is the smallest ecosystem I have ever seen and it made me feel very large and very small at the same time.",
    reason: "You liked this"
  },
  {
    section: "Curious",
    source: "Saved from a history thread",
    author: "Eli Brennan",
    handle: "@eli_walks",
    text: "Looked up the history of my street name. It turns out it is named after a woman who ran a bakery here in the 1890s and gave bread to kids on their way to school. I walk past her bakery's old foundation every day and never knew.",
    reason: "You saved this"
  },
  // Humane
  {
    section: "Humane",
    source: "Saved from a mutual aid group",
    author: "Ada Franklin",
    handle: "@ada_helps",
    text: "Our block rallied around the family whose apartment flooded. In two days we had clothes, meals for a week, and a plumber volunteering his Saturday. The mom said she did not know people still did this. We said we learned it from her.",
    reason: "You saved this"
  },
  {
    section: "Humane",
    source: "Saved from a care circle",
    author: "Jules Park",
    handle: "@jules_sits",
    text: "I sat with a patient in the hospital who had no visitors. We talked about his garden for an hour. Before I left he said, 'Thank you for treating me like a person and not a chart.' I will carry that with me for a long time.",
    reason: "You liked this"
  },
  {
    section: "Humane",
    source: "Saved from a community board",
    author: "Mira Stone",
    handle: "@mira_reads",
    text: "Put up a little free library on our corner. It has been one week. A teenager left a note inside that said, 'I took a book and I will bring one back and I think this is the nicest thing on our street.' It absolutely is.",
    reason: "You saved this"
  }
];
