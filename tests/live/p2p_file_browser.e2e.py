# Live test with real WebRTC: a 25 MB file is offered while the friend is
# offline, waits on the sender's device, and is transferred device to device
# when both are online; no Sia involved. Needs /tmp/video25.bin.
# Run: python3 tests/live/p2p_file_browser.e2e.py
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
    A=setup(b.new_context(viewport={"width":1280,"height":860})); Bctx=b.new_context(viewport={"width":1280,"height":860}); B=setup(Bctx)
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:140]) if m.type=="error" else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)")
    B.click(".request-banner button:has-text('Accept')")
    # Bob goes offline: his page is closed.
    B.close(); time.sleep(2)
    A.set_input_files("input[aria-label='Files to send']", ["/tmp/video25.bin"])
    A.wait_for_selector(".message.out:has-text('video25.bin')", timeout=60000)
    A.wait_for_selector("text=Waiting for your friend to come online", timeout=30000); print("A: file waiting on A's device (Bob offline)")
    # Bob comes back (same browser profile, so same device).
    B=Bctx.new_page(); B.on("console", lambda m: errs.append("B2: "+m.text[:140]) if m.type=="error" else None)
    B.goto(URL, timeout=60000); B.wait_for_selector(".convo:has-text('video25.bin'), .convo .unread", timeout=120000)
    B.click(".convo >> nth=0"); t=time.time()
    B.wait_for_selector(".message.in:has-text('video25.bin') button[aria-label^='Save']", timeout=240000)
    print(f"B: received over the direct link in {round(time.time()-t)} s:", B.inner_text(".message.in:has-text('video25.bin') .att-size"))
    A.wait_for_selector(".message.out:has-text('video25.bin') button[aria-label^='Save']", timeout=60000)
    print("A: shown as delivered; errors:", [e for e in errs if 'pubKeyCred' not in e][:3]); delete_accounts(b); b.close()
