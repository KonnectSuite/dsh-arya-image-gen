import { describe, expect, it } from 'vitest'
import { looksLikeWebPage, pageWarning } from '../src/render/web-page-guard.js'

describe('web page guard', () => {
  it('passes a self-contained card', () => {
    expect(looksLikeWebPage('<div style="padding:24px"><h1>Hello</h1></div>')).toBeUndefined()
    expect(looksLikeWebPage('<div><img src="data:image/png;base64,AAAA"></div>')).toBeUndefined()
    expect(looksLikeWebPage('<a href="#top">top</a>')).toBeUndefined()
  })

  it('flags script tags', () => {
    expect(looksLikeWebPage('<div>x</div><script src="app.js"></script>')).toContain('script tags')
  })

  it('flags a linked stylesheet', () => {
    expect(looksLikeWebPage('<link rel="stylesheet" href="/assets/site.css">')).toContain('stylesheet')
  })

  it('flags page landmarks', () => {
    expect(looksLikeWebPage('<header>nav</header><main>content</main>')).toContain('landmarks')
  })

  it('flags relative asset paths', () => {
    expect(looksLikeWebPage('<section><img src="./img/hero.webp"></section>')).toContain('relative path')
  })

  it('wording points at the browser route', () => {
    const text = pageWarning('it contains script tags')
    expect(text).toContain('web page')
    expect(text).toContain('dev server')
    expect(text).toContain('browser')
  })
})
