# Verbatim

WhatsApp orders in, a clean order sheet out, and no guessed lines.

A small bakery takes orders as messy chat and voice notes ("2 dozen meat pies, 3 pies and some doughnuts pls"). Verbatim reads each message with an open-weight model (Gemma 4), then a deterministic validator checks every proposed line against the shop's real price list. A line is confirmed only if the item, the quantity and the unit are all written in the customer's own words. Anything else is held, with a short question to send back.

## What the validator refuses

- Quantities that aren't written in the message, or that are vague ("some", "a few", "2 or 3", "maybe 4")
- Numbers that don't count the product ("cupcakes for 10 people")
- Ambiguous products ("3 pies" when the shop sells meat and chicken pies)
- Items that aren't on the price list. Typos get a "Did you mean…?" question, never an auto-correction.
- Units the product isn't sold in ("a dozen big loaves")
- Parts of the message the model skipped
- Prices from the model. Amounts always come from the catalog.

## Results

Same Gemma 4 extractions, scored two ways: "bare model" trusts the model's lines as-is, and "Verbatim" runs them through the validator.

Development set: 72 messages, 68 orderable lines.

| | Correct lines | Wrong lines committed | Lines lost silently | Messages fully right |
|---|---|---|---|---|
| Bare model | 64 | 9 | 4 | 34 |
| Verbatim | 65 | 0 | 0 | 69 |

Held-out set: 25 messages written after the validator was finished and never tuned on.

| | Correct lines | Wrong lines committed | Lines lost silently | Messages fully right |
|---|---|---|---|---|
| Bare model | 27 | 3 | 0 | 15 |
| Verbatim | 25 | 0 | 0 | 23 |

The cost is questions. Verbatim asks the customer instead of guessing, so a few clear lines (typos, "actually make it 3") get held when a person would have understood them.

## Run it

Hosted version (Cloudflare Worker, Gemma 4 and Whisper on Workers AI):

```
npx wrangler dev
```

Fully local version (any OpenAI-compatible server such as Ollama, plus the local `whisper` CLI):

```
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=gemma3:12b npm start
```

Tests and eval:

```
npm test
node eval.js                     # development set
node eval.js test/holdout.json   # held-out set
```

`catalog.json` is the price list. Edit it for a different shop.
