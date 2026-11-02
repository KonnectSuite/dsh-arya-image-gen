# Reference images from the web

An image model knows the idea of the Eiffel Tower, not this Eiffel Tower on
this site. When the request names something real, the difference between an
approximation and an accurate picture is usually a photograph of the actual
subject.

`import_reference_image` is the bridge: it turns a public image URL into a file
in the session workspace that `edit_image` can consume as `source_path`.

## The loop

1. **Search.** `web_search` for the subject plus a source hint. Official,
   manufacturer, government, museum and press pages beat stock libraries, which
   are watermarked and often recoloured.
2. **Follow.** `web_fetch` the best page and find the image URL — `og:image`, a
   hero `<img>`, or a press-kit link. A result page is not an image; handing its
   URL to the importer fails on purpose.
3. **Import.** `import_reference_image(url, name?)`. The reply carries the
   workspace `path`, the sniffed media type, byte size, pixel dimensions and a
   short content digest.
4. **Edit from it.** `edit_image(source_path=…)` with a prompt that says what
   must stay and what may change. "Keep the subject from the reference, change
   the scene to dusk" beats a long re-description, which makes the model
   substitute a lookalike.
5. **Report.** Name the pages used, and do not claim the result is the real
   photograph.

## What the tool guarantees

| check | behaviour |
|---|---|
| scheme | `http` and `https` only; credentials in the URL are refused |
| address | every resolved address must be public — loopback, private, link-local and CGNAT ranges are refused, including after redirects |
| redirects | at most four hops, each re-validated before it is fetched |
| payload | PNG, JPEG or WebP decided by magic bytes, not by `content-type`; an HTML page is refused with the declared type in the message |
| size | 16 MB cap, enforced while streaming, not only from `content-length` |
| location | `<workspace>/<workspaceFolder>/references/`; the folder may not resolve outside the workspace |
| naming | digits/letters/dots/dashes, 48 characters, extension from the real type; an existing name gets `-2`, `-3` rather than being overwritten |

Nothing is attached to the conversation and no generation happens: a reference
is an input.

## Choosing sources

- **Do** prefer the subject's own organisation (manufacturer, museum, ministry,
  press office), Wikimedia Commons for landmarks, and official press kits for
  products and logos.
- **Do** import the variant that matters: a 2024 model of the car, not a 1998
  one; the front three-quarter view if the picture asked for is a front view.
- **Don't** use watermarked previews, thumbnails under ~600 px, or an image that
  has been recoloured by a third party.
- **Don't** reproduce a living private person, pass off a competitor's mark as
  the user's own, or reuse a character sheet as official art.

## Which preset has the web tools

`Arya Image` mounts `tool-web` as one of its own rows (search plus fetch), so the
loop works there directly — as it does on **Standard mode** and **Arya
Standard**. `Arya Qwen` does not mount the web rows, so it has no search.

The history is worth knowing if you extend the preset: an earlier version kept
the image tools and relied on masking the inherited ones. A mask can only name
what the host registers globally, so that preset ended up with the image tools
and none of `read`, `pwsh` or `web_search`. The row list is the mechanism; the
mask was removed.

## Failure messages, and what they mean

| message | cause |
|---|---|
| `did not return a PNG, JPEG or WebP image (text/html)` | you imported a page, not a file — fetch the page and take the image URL |
| `the reference host resolves to a private address` | the URL points at localhost, a LAN host, or an internal service |
| `the reference URL answered 404` | the page moved; search again instead of retrying |
| `the reference image is over the 16777216-byte limit` | a full-resolution original; find a smaller rendition |
| `cannot resolve the reference host` | DNS failed — offline, or the domain is wrong |

## Cost and limits

One import is one HTTP request; three references per request is plenty and four
is usually worse than one. Image-to-image passes in ComfyUI consume the first
source image, so extra references describe, they do not multiply detail.
