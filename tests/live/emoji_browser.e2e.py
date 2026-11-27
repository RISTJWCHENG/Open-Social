# Live test: the sticker button opens the emoji panel; categories, search,
# inserting at the cursor, sending, and recents that survive a reload.
# Run: python3 tests/live/emoji_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":860}); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000); pg.click("button.rail-me"); pg.wait_for_selector(".composer")
    pg.click("button[aria-label='Emoji, GIFs and stickers']"); pg.wait_for_selector(".emoji-cell")
    print("emoji in panel:", pg.locator(".emoji-cell").count())
    pg.screenshot(path="/tmp/emoji-panel.png")
    pg.click("button[aria-label='Flags']"); pg.wait_for_timeout(300)
    print("Flags tab active after jump:", pg.get_attribute("button[aria-label='Flags']", "aria-selected"))
    print("Flags heading at top of the list:", pg.evaluate("() => { const sc = document.querySelector('.emoji-scroll'); const h = document.querySelector(\"section[aria-label='Flags'] h3\"); return Math.round(h.getBoundingClientRect().top - sc.getBoundingClientRect().top); }"), "px")
    for cat in ("Food & drink", "Symbols"):
        pg.click(f"button[aria-label='{cat}']"); pg.wait_for_timeout(200)
        print(f"{cat} heading offset:", pg.evaluate(f"() => {{ const sc = document.querySelector('.emoji-scroll'); const h = document.querySelector(\"section[aria-label='{cat}'] h3\"); return Math.round(h.getBoundingClientRect().top - sc.getBoundingClientRect().top); }}"), "px | active:", pg.get_attribute(f"button[aria-label='{cat}']", "aria-selected"))
    pg.click("button[aria-label='Flags']"); pg.wait_for_timeout(200)
    print("flags:", pg.locator("section[aria-label='Flags'] .emoji-flag").count(), "| symbol flags:", pg.locator(".emoji-cell[aria-label*='chequered'], .emoji-cell[aria-label*='pirate']").count())
    pg.locator(".emoji-panel").screenshot(path="/tmp/flags.png")
    pg.fill("#draft", "Hello  world"); pg.evaluate("() => { const i = document.querySelector('#draft'); i.setSelectionRange(6, 6); }")
    pg.click("button[aria-label='Emoji, GIFs and stickers']") if not pg.locator(".emoji-panel").count() else None
    pg.fill("input[aria-label='Search emoji']", "party")
    pg.click(".emoji-panel button[aria-label='party popper']")
    print("draft after insert:", repr(pg.input_value("#draft")))
    pg.click("button[aria-label='Send encrypted']")
    pg.wait_for_selector(".message.out:has-text('🎉')", timeout=20000); print("sent with emoji")
    pg.keyboard.press("Escape")
    pg.reload(); pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    if not pg.locator(".composer").count(): pg.click("button.rail-me")
    pg.wait_for_selector(".composer"); pg.click("button[aria-label='Emoji, GIFs and stickers']"); pg.wait_for_selector(".emoji-cell")
    print("recent after reload:", pg.locator("section[aria-label='Recent'] .emoji-cell").all_inner_texts())
    print("errors:", errs[:3]); delete_accounts(b); b.close()
