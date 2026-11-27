# Live test: two passkey accounts on the ICP site; A sends a photo and a
# 150 KB file to B; B sees the photo inline and the file card with its name.
# Run: python3 tests/live/attachments_browser.e2e.py   (needs /tmp/photo.png, /tmp/notes.pdf)
import time
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
    A=setup(b.new_context(viewport={"width":1280,"height":860})); B=setup(b.new_context(viewport={"width":1280,"height":860}))
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:150]) if m.type=="error" else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    t=time.time()
    A.set_input_files("input[aria-label='Files to send']", ["/tmp/photo.png", "/tmp/notes.pdf"])
    A.wait_for_selector(".message.out .att-name:has-text('notes.pdf')", timeout=120000)
    A.wait_for_selector(".message.out img.att-media", timeout=60000)
    print("A: both files shown as sent after", round(time.time()-t,1), "s")
    B.wait_for_selector(".convo:has-text('Bob')", timeout=5000) if False else None
    B.wait_for_selector(".convo .request-tag", timeout=120000); B.click(".convo:has(.request-tag)")
    B.wait_for_selector(".message.in img.att-media", timeout=120000)
    B.wait_for_selector(".message.in .att-name:has-text('notes.pdf')", timeout=120000)
    size=B.inner_text(".message.in .att-size")
    print("B: photo shown inline; file card:", B.inner_text(".message.in .att-name"), "|", size)
    B.click("[role=tab]:has-text('Media')"); B.wait_for_selector(".media-grid img.att-media", timeout=20000); B.click("[role=tab]:has-text('Files')"); B.wait_for_selector(".file-list .att-name:has-text('notes.pdf')", timeout=20000); print("B: profile panel lists the photo (Media) and the file (Files)")
    B.screenshot(path="/tmp/att-b.png")
    print("console errors:", errs[:4]); delete_accounts(b); b.close()
