# Live test: the Contacts view from the left rail: add a friend by ID, a
# request from someone who wrote first (accept), and opening a chat.
# Run: python3 tests/live/contacts_browser.e2e.py
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
    A=setup(b.new_context(viewport={"width":1280,"height":860})); B=setup(b.new_context(viewport={"width":1280,"height":860})); C=setup(b.new_context(viewport={"width":1280,"height":860}))
    A.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); pC=signup(C); pA=signup(A)
    # Carol writes to Alice first.
    C.click("button[aria-label='New chat']"); C.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pA); C.fill("input[placeholder='e.g. Alice from work']", "Alice")
    C.click("text=Start chat"); C.wait_for_selector("main[aria-label='Conversation with Alice']", timeout=30000)
    C.fill("#draft", "hi Alice, it's Carol"); C.click("[aria-label='Send encrypted']")
    # Alice: Contacts > Add contact (Bob, by ID).
    A.click("button[aria-label='Contacts']"); A.wait_for_selector("section[aria-label='Contacts']")
    A.click("button[aria-label='Add']"); A.click("[role=menuitem]:has-text('Add person')"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("button:has-text('Add to contacts')"); A.wait_for_selector("text=Bob is now in your contacts.", timeout=30000); print("A added Bob")
    A.click("button[aria-label='Close add person']")
    A.wait_for_selector("section[aria-label='Requests'] .contact-row", timeout=90000)
    print("Requests:", A.locator("section[aria-label='Requests'] .contact-name").all_inner_texts(), "| Friends:", A.locator("section[aria-label='Friends'] .contact-name").all_inner_texts())
    A.screenshot(path="/tmp/contacts.png", clip={"x":0,"y":0,"width":440,"height":520})
    A.click("section[aria-label='Requests'] button:has-text('Accept')"); A.wait_for_timeout(800)
    print("after Accept, Friends:", A.locator("section[aria-label='Friends'] .contact-name").all_inner_texts(), "| heading:", A.inner_text("section[aria-label='Friends'] .contacts-heading"))
    A.click("section[aria-label='Friends'] .contact-main:has-text('Bob')")
    A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=10000)
    print("clicking Bob opened:", A.get_attribute("main.chat-main", "aria-label"), "| left column:", A.get_attribute("section.chat-list", "aria-label"))
    print("errors:", errs[:3]); delete_accounts(b); b.close()
