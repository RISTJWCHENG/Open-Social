# Live test: the ▾ arrow appears on hover; the chat menu pins, mutes,
# favourites, archives, marks unread, clears and deletes.
# Run: python3 tests/live/chat_menu_browser.e2e.py
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
    A=setup(b.new_context(viewport={"width":1280,"height":860}))
    friends=[]
    for n in ("Bob","Carol"):
        F=setup(b.new_context(viewport={"width":1280,"height":860})); friends.append((n, signup(F)))
    A.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    signup(A)
    for n,p in friends:
        A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", p); A.fill("input[placeholder='e.g. Alice from work']", n)
        A.click("text=Start chat"); A.wait_for_selector(f"main[aria-label='Conversation with {n}']", timeout=30000)
        A.fill("#draft", f"hi {n}"); A.click("[aria-label='Send encrypted']"); A.wait_for_timeout(800)
    row = lambda n: A.locator(f".convo-row:has(.convo-name:text-is('{n}'))")
    names = lambda: A.locator(".convo-row .convo-name").all_inner_texts()
    print("arrow hidden before hover:", row("Bob").locator(".convo-more").evaluate("e => getComputedStyle(e).opacity"))
    row("Bob").hover(); A.wait_for_timeout(250)
    print("arrow on hover:", row("Bob").locator(".convo-more").evaluate("e => getComputedStyle(e).opacity"))
    row("Bob").locator(".convo-more").click(); A.wait_for_selector(".chat-menu")
    print("menu:", A.locator(".chat-menu > .chat-menu-row > [role=menuitem]").all_inner_texts())
    A.screenshot(path="/tmp/chat-menu.png", clip={"x":60,"y":120,"width":560,"height":560})
    A.click(".chat-menu [role=menuitem]:has-text('Pin chat')"); A.wait_for_timeout(300)
    print("after pin Bob:", names(), "| pin icon:", row("Bob").locator("svg[aria-label='Pinned']").count())
    row("Bob").hover(); row("Bob").locator(".convo-more").click(); A.hover(".chat-menu [role=menuitem]:has-text('Mute notifications')")
    A.click(".chat-submenu [role=menuitem]:has-text('Always')"); A.wait_for_timeout(300)
    print("muted icon:", row("Bob").locator("svg[aria-label='Muted']").count())
    row("Carol").hover(); row("Carol").locator(".convo-more").click(); A.click(".chat-menu [role=menuitem]:has-text('Add to Favorites')")
    A.click("button:text-is('Favorites')"); A.wait_for_timeout(200); print("Favorites filter:", names()); A.click("button:text-is('All')")
    row("Carol").hover(); row("Carol").locator(".convo-more").click(); A.click(".chat-menu [role=menuitem]:has-text('Mark as unread')"); A.wait_for_timeout(300)
    print("Carol marked unread dot:", row("Carol").locator(".unread-dot").count())
    row("Carol").hover(); row("Carol").locator(".convo-more").click(); A.click(".chat-menu [role=menuitem]:has-text('Archive chat')"); A.wait_for_timeout(300)
    print("after archive Carol:", names(), "| Archived row:", A.inner_text(".archived-row").replace("\n"," "))
    A.click(".archived-row"); print("archived view:", names()); A.click(".archived-row")
    row("Bob").hover(); row("Bob").locator(".convo-more").click(); A.click(".chat-menu [role=menuitem]:has-text('Clear chat')")
    A.wait_for_selector(".dialog"); print("dialog:", A.inner_text(".dialog h2")); A.click(".dialog button:has-text('Clear chat')"); A.wait_for_timeout(400)
    print("Bob preview after clear:", row("Bob").locator(".convo-preview").inner_text())
    row("Bob").hover(); row("Bob").locator(".convo-more").click(); A.click(".chat-menu [role=menuitem]:has-text('Delete chat')")
    A.click(".dialog button:has-text('Delete chat')"); A.wait_for_timeout(400)
    print("after delete Bob:", names())
    print("errors:", errs[:3]); delete_accounts(b); b.close()
