# Live test: an old OpenSocial tab holds the device database at an older version.
# Sign-in must show a clear message instead of hanging, and work once that tab closes.
# Run: python3 tests/live/blocked_db_browser.e2e.py
import time
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context()
    old=ctx.new_page(); old.goto(URL+"third-party-licenses.txt")
    # An "old tab": holds the opensocial database open at version 1, ignoring version changes.
    print("old tab:", old.evaluate("""() => new Promise(r => { const q = indexedDB.open('opensocial', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => { window.keep = q.result; r('holding v1'); }; })"""))
    pg=ctx.new_page(); cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    t=time.time(); create_account(pg)
    try:
        pg.wait_for_selector("text=Close the other OpenSocial tabs", timeout=60000)
        print("new tab: clear message after", round(time.time()-t,1), "s")
    except Exception:
        print("new tab: NO MESSAGE; body:", pg.inner_text("body")[:200].replace("\n"," | "))
    # The old tab closes: signing in now works.
    old.close(); pg.reload(); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg)
    pg.wait_for_selector("text=Skip for now", timeout=120000); print("after closing the old tab: signed in")
    delete_accounts(b); b.close()
