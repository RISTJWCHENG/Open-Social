# Live test: four same-size icons at the top right (search, pin, calls);
# pin toggles; search replaces the icons, finds and highlights messages. Run: python3 tests/live/chat_toolbar_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts, my_principal
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
def setup(ctx):
    pg=ctx.new_page(); cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    return pg
def signup(pg):
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000)
    p=my_principal(pg); return p
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    A=setup(b.new_context(viewport={"width":1280,"height":760})); B=setup(b.new_context(viewport={"width":1280,"height":760}))
    A.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)"); B.click(".request-banner button:has-text('Accept')")
    words=["apple","banana","Kavárna Slavia","cherry","Save to my Sia","date","elderberry","fig","grape","Sia storage","honeydew","kiwi","lemon","mango"]
    for w in words:
        A.fill("#draft", f"message about {w}"); A.press("#draft","Enter"); A.wait_for_timeout(250)
    A.wait_for_function("() => [...document.querySelectorAll('.message.out')].length >= 15", timeout=60000)
    A.wait_for_timeout(1500)
    sizes = A.evaluate("() => [...document.querySelectorAll('.chat-toolbar .chat-toolbar-btn')].map((b) => { const r = b.getBoundingClientRect(), i = b.querySelector('svg').getBoundingClientRect(); return [b.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height), Math.round(i.width), Math.round(i.height), Math.round(r.top)]; })")
    print("icons [label, button w, h, icon w, h, top]:", sizes)
    bar = A.locator(".chat-toolbar").bounding_box(); main = A.locator("main.chat-main").bounding_box()
    print("top right:", round(main["x"] + main["width"] - (bar["x"] + bar["width"])), "px from the right,", round(bar["y"] - main["y"]), "px from the top")
    A.locator(".chat-toolbar").screenshot(path="/tmp/tb-icons.png")
    A.click("button[aria-label='Pin chat']"); A.wait_for_timeout(500)
    print("pinned:", A.locator("button[aria-label='Unpin chat']").count(), "| list pin mark:", A.locator(".convo-row svg[aria-label='Pinned']").count())
    A.click("button[aria-label='Search this chat']"); A.fill("input[aria-label='Search this chat']", "sia")
    print("while searching, other icons:", A.locator(".chat-toolbar-btn").count())

    A.wait_for_timeout(600)
    print("search 'sia':", A.inner_text(".chat-search-count"), "| marks:", A.locator(".bubble-text mark").all_inner_texts())
    A.locator("main.chat-main").screenshot(path="/tmp/toolbar-search.png")
    A.press("input[aria-label='Search this chat']", "Enter"); A.wait_for_timeout(500)
    print("after Enter:", A.inner_text(".chat-search-count"), "| current:", A.locator(".message.search-current .bubble-text").inner_text())
    A.keyboard.press("Escape"); A.wait_for_timeout(200); print("closed, marks left:", A.locator(".bubble-text mark").count(), "| icons back:", A.locator(".chat-toolbar-btn").count())
    print("errors:", errs[:3]); delete_accounts(b); b.close()
