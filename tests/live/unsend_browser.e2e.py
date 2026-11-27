# Live test: delete for everyone. Alice's text and photo disappear from Bob's
# chat and the photo's stored bytes leave his device; placeholders remain.
# Run: python3 tests/live/unsend_browser.e2e.py  (needs /tmp/p0.jpg)
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
# Counts the stored file entries in Bob's encrypted IndexedDB.
FILES = "() => new Promise((res) => { const r = indexedDB.open('opensocial'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('files', 'readonly'); const c = tx.objectStore('files').count(); c.onsuccess = () => { res(c.result); db.close(); }; }; r.onerror = () => res(-1); })"
def delete_for_everyone(pg, text):
    bubble = pg.locator(f".message.out .bubble:has-text('{text}')") if text else pg.locator(".message.out .bubble.has-attachment").last
    bubble.hover(); bubble.locator("xpath=..").locator(".msg-action[aria-label='Message options']").click()
    pg.click("[role=menuitem]:has-text('Delete for everyone')"); pg.click(".dialog button:has-text('Delete for everyone')")
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    A=setup(b.new_context(viewport={"width":1280,"height":860})); B=setup(b.new_context(viewport={"width":1280,"height":860}))
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)"); B.click(".request-banner button:has-text('Accept')")
    A.fill("#draft","this was a mistake"); A.click("[aria-label='Send encrypted']")
    with A.expect_file_chooser() as fc: A.click("button[aria-label='Attach files']")
    fc.value.set_files(["/tmp/p0.jpg"]); A.fill("#draft", "private photo"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".message.in:has-text('this was a mistake')", timeout=90000)
    B.wait_for_selector(".message.in:has-text('private photo') img", timeout=90000)
    before = B.evaluate(FILES); print("Bob has the text and the photo; stored file entries:", before)
    delete_for_everyone(A, "this was a mistake"); delete_for_everyone(A, None)
    print("Alice sees:", A.locator(".bubble-deleted").all_inner_texts())
    B.wait_for_function("() => document.querySelectorAll('.message.in .bubble-deleted').length >= 2", timeout=90000)
    print("Bob sees:", B.locator(".message.in .bubble-deleted").all_inner_texts(),
          "| text gone:", B.locator("text=this was a mistake").count() == 0, "| photo gone:", B.locator(".message.in img.att-media").count() == 0,
          "| stored file entries:", before, "->", B.evaluate(FILES))
    B.locator(".messages").screenshot(path="/tmp/unsend.png")
    print("errors:", errs[:3]); delete_accounts(b); b.close()
