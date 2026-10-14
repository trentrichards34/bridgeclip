# Brand Identity for CreatorClips Remix

CreatorClips' Remix reads a member's Brand Identity to write every reaction in
that brand's voice, with that brand's beliefs, and only that brand's real proof.
Any text works, but takes are noticeably better when the document follows the
sections below, in this order, with these headings.

## Sections

| Section | What it holds | How Remix uses it |
|---|---|---|
| BRAND, WHO WE HELP, CORE PROMISE | Name, the specific audience, the one-sentence result | Frames every take for the right viewer |
| WHAT WE BELIEVE | 3-7 beliefs, each with *why* and *proof* | Decides whether to agree, disagree or add nuance to a moment |
| MYTHS WE PUSH BACK ON | Common claims in the niche and the brand's counter-take | Powers "Myth vs. truth" and "Do this instead" remixes |
| OUR METHOD | The named framework and its steps | The "better way" and the voice-over beats |
| PROOF WE CAN USE | Real, approved numbers, results, testimonials | The ONLY numbers and results a take may use. Anything else is dropped |
| VOICE | Tone, words used, words never used, how the brand disagrees | Script wording and the delivery of the AI voice |
| OFF-LIMITS | Claims never made, topics avoided | Hard limits for the writer |
| CALL TO ACTION (optional) | What to say at the end, ideally a comment keyword: `Comment PULL-UP and I'll send you the free plan` | The closing line, the on-screen keyword and the caption's last line. Remix offers a keyword written in capitals here as a one-click choice. |

Rules for the generator:

- Use only facts from the member's materials (course, membership area, sales
  page, transcripts). Never invent results, numbers or testimonials; leave a
  section short rather than pad it.
- Keep it under 40,000 characters; 1,500-6,000 is typical.
- Plain text or Markdown. The member pastes it into Remix → Your take → Add,
  or imports it as a .txt or .md file.

## Generator prompt (for the membership-area button)

```
You are writing a Brand Identity document that an AI video tool will use to
react to other creators' videos in this brand's voice. Use ONLY the material
provided below (course lessons, membership area, sales page, transcripts).
Never invent results, numbers, testimonials or claims; if something is not in
the material, leave that line out.

Write it in exactly this format and order:

BRAND: <name>
WHO WE HELP: <specific person, situation, desire>
CORE PROMISE: <one sentence>

WHAT WE BELIEVE (3-7 beliefs)
1. Belief: <a clear position not everyone shares>
   Why: <the reasoning, in the brand's words>
   Proof: <a real result, client story or reason from the material>

MYTHS WE PUSH BACK ON (3-8)
- Myth: <what people in this niche commonly say>
  Our take: <the brand's counter-position and why>

OUR METHOD
- Name: <framework name>
- Steps: 1. ... 2. ... 3. ...

PROOF WE CAN USE
- <only real, specific results, numbers and testimonials found in the material>

VOICE
- Tone: ...
- Words we use: ...
- Words we never use: ...
- How we disagree: <e.g. firm but respectful; never mock the person>

OFF-LIMITS
- Claims we never make: ...
- Topics we avoid: ...

CALL TO ACTION: <optional, from the material; when the member uses a comment keyword, write it in capitals: Comment GUIDE and I'll send you …>

MATERIAL:
<<<paste the member's materials here>>>
```
