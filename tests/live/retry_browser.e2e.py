# Live test: the network drops halfway through a 6 MB upload; the message
# shows "Not sent · Retry"; with the network back, clicking it completes the
# file for the receiver. Run: python3 tests/live/retry_browser.e2e.py  (needs /tmp/clip6.bin)
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
    b=pw.chromium.launch(); Actx=b.new_context(viewport={"width":1280,"height":860}); A=setup(Actx); B=setup(b.new_context(viewport={"width":1280,"height":860}))
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)"); B.click(".request-banner button:has-text('Accept')")
    A.evaluate("() => window.dispatchEvent(new Event('noop'))")
    # Keep the file on the mailbox path: no direct link for this test.
    A.click("[aria-label='Menu']"); A.click(".menu-settings"); A.click("[role=tab]:has-text('Community')")
    if A.is_checked("text=Allow direct connections with friends"): A.click("text=Allow direct connections with friends")
    A.click("[aria-label='Close settings']")
    with A.expect_file_chooser() as fc: A.click("button[aria-label='Attach files']")
    fc.value.set_files(["/tmp/clip6.bin"]); A.click("button[aria-label='Send encrypted']")
    # Wait until part of it is uploaded, then cut the network.
    A.wait_for_function("() => { const m = document.body.textContent.match(/Sending… (\\d+)%/); return m && +m[1] >= 15; }", timeout=120000)
    Actx.set_offline(True); print("A: network cut during upload")
    A.wait_for_selector(".message.out button.retry-btn", timeout=60000); print("A shows:", A.inner_text(".message.out button.retry-btn"))
    Actx.set_offline(False); time.sleep(1)
    B.wait_for_function("() => /Receiving… \\d+%/.test(document.body.textContent)", timeout=90000)
    print("B before retry:", B.evaluate("() => (document.body.textContent.match(/Receiving… \\d+%/) || [''])[0]"))
    A.click(".message.out button.retry-btn")
    A.wait_for_function("() => { const t = [...document.querySelectorAll('.message.out')].at(-1)?.textContent || ''; return !t.includes('Not sent') && !t.includes('Sending'); }", timeout=180000)
    print("A after retry: sent")
    B.wait_for_selector(".message.in:has-text('clip6.bin') button[aria-label^='Save']", timeout=180000)
    print("B: file complete:", B.inner_text(".message.in:has-text('clip6.bin') .att-size")); delete_accounts(b); b.close()
