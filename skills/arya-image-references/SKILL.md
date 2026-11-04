---
name: arya-image-references
description: Ground image work in a real reference photo when the request names something specific or real - a product, a landmark, a vehicle, a brand logo, a uniform, a public figure - by searching the web for the actual subject, importing the picture into the workspace, and editing from it. Use it whenever an accurate likeness matters more than a plausible one, or when a description alone would make the model invent details.
---

# Reference images for real subjects

A text prompt can describe a thing; it cannot reproduce it. For anything that
already exists in the world, one real photograph produces a far more accurate
image than a paragraph, and it stops the model from inventing the details it
cannot know - the exact badge layout on a car, which way a landmark's arches
run, the specific shade of a brand's green.

## When a reference is worth it

| the request | reference? |
|---|---|
| a real product, machine, vehicle, aircraft, building | yes - the real subject |
| a brand logo or wordmark | yes - official artwork only |
| a uniform, kit, badge or insignia | yes - an authoritative photo |
| a public figure's likeness | only a photo the user themselves supplied; never scrape a private person |
| a fictional character | optional - fan art and official sheets, credit the source |
| a generic scene, mood or style | no - a description is better and cheaper |
| exact legible text in the image | no - that is not a reference problem; say so instead of faking it |

## The loop

1. **Search** with the host's `web_search` for the subject plus a source hint:
   `"Eiffel Tower" official photos site:paris convention bureau`, `"F-35A" tail
   number photo site:af.mil`. Official, manufacturer, government, museum and
   press pages beat stock sites, which are watermarked and often re-coloured.
2. **Follow** the best result with `web_fetch` and read the page for a candidate
   image URL - `og:image`, a `src`/`srcset` in a hero image, or a press-kit link.
   The search page itself is not an image; do not hand its URL to the importer.
3. **Import** each candidate with `import_reference_image`:

   ```
   import_reference_image(url="https://…/externalContent/…/eiffel-tower.jpg", name="eiffel-tower")
   ```

   It answers with a workspace `path`, the real media type, byte size and pixel
   dimensions. Two failures are normal and both are informative: `did not return
   a PNG, JPEG or WebP image (text/html)` means you followed a page, not a file;
   `private address` means the URL pointed somewhere the host refuses to fetch.
4. **Edit from the reference** - the imported path is what `edit_image` takes:

   ```
   edit_image(source_path="C:/…/references/eiffel-tower.png", prompt="Keep the tower's proportions, tier spacing and arch shape exactly as in the reference; render it at dusk, warm interior lights on, seen from the Trocadéro gardens, no people.")
   ```

   Say what must stay and what may change. "Keep the subject from the reference"
   plus the specific changes beats a long re-description of the subject, which
   makes the model substitute a lookalike.
5. **When two references matter** (a car from the front and the rear, a product
   and its logo), import both and edit from the one that carries the shape; name
   the other in the prompt. ComfyUI edits the first source image only.

## Rules

- **Import at most three references** and pick the one that shows the subject
  clearly: sharp, unwatermarked, the right variant. More inputs do not improve
  an image-to-image pass.
- **Credit and be honest.** Name the pages you used in your reply, and do not
  claim the output is a photograph of the real thing; it is an interpretation
  built from a reference.
- **Respect the limits you can see.** Do not reproduce a living private person,
  a copyrighted character sheet as if it were official art, or a competitor's
  logo as the user's own. If the request needs permission, say so.
- **No web tools?** Ask the user to attach the picture instead of inventing the
  subject. The `Arya Image` preset keeps `web_search`/`web_fetch` only when the
  composition provides them; a headless or offline host has none.
- **Never silently fall back** from "the real Eiffel Tower" to "an
  Eiffel-Tower-ish tower" when the reference search failed. Say it failed and
  offer to try another source.
