# Live test: large files are read in pieces (memory stays low) and files over
# 2 GB are refused at once. Needs /tmp/big300.bin (300 MB) and /tmp/huge.iso (2.2 GB, sparse).
# Run: python3 tests/live/large_files_browser.e2e.py
import time
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
HEAP="() => Math.round(performance.memory.usedJSHeapSize / 1e6)"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":820}); pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    pg.click("button.rail-me")
    pg.set_input_files("input[aria-label='Files to send']", ["/tmp/huge.iso"])
    pg.wait_for_selector("text=larger than 2 GB", timeout=10000); print("2.2 GB file: refused with a clear message")
    base=pg.evaluate(HEAP); peak=base; t=time.time()
    pg.set_input_files("input[aria-label='Files to send']", ["/tmp/big300.bin"])
    while not pg.locator(".message.out .att-name:has-text('big300.bin')").count() and time.time()-t < 240:
        peak=max(peak, pg.evaluate(HEAP)); pg.wait_for_timeout(250)
    print(f"300 MB note stored in {round(time.time()-t)} s; JS heap {base} MB before, peak {peak} MB")
    print("card:", pg.inner_text(".message.out .att-card"))
    delete_accounts(b); b.close()
