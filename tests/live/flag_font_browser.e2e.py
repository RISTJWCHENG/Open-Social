# Live test: with the flag font on (as on Windows), the font loads under the
# site's style policy and draws the flags. Run: python3 tests/live/flag_font_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":860}); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:160]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    print("flag font on by itself here (system has flags):", pg.evaluate("document.documentElement.classList.contains('flag-font')"))
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000); pg.click("button.rail-me"); pg.wait_for_selector(".composer")
    pg.evaluate("document.documentElement.classList.add('flag-font')")  # what Windows gets
    pg.click("button[aria-label='Emoji, GIFs and stickers']"); pg.wait_for_selector(".emoji-cell"); pg.click("button[aria-label='Flags']"); pg.wait_for_timeout(300)
    loaded = pg.evaluate("async () => (await document.fonts.load('28px \"Twemoji Country Flags\"', '\\u{1F1E7}\\u{1F1EA}')).length")
    print("flag font faces loaded:", loaded)
    print("font of a flag cell:", pg.evaluate("getComputedStyle(document.querySelector('.emoji-flag .emoji-glyph')).fontFamily").split(',')[0])
    pg.wait_for_timeout(500)
    pg.locator(".emoji-panel").screenshot(path="/tmp/flags-font.png")
    print("errors (CSP etc.):", errs[:3]); delete_accounts(b); b.close()
