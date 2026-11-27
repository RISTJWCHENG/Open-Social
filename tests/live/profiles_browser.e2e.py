# Live two-user browser test: public profile + search (profiles canister), sealed
# friends-only profile shared by key, message request accept, going private, and
# account deletion. Needs /tmp/a.png and /tmp/b.png.
# Run: python3 tests/live/profiles_browser.e2e.py
import random, string
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
tag=''.join(random.choice(string.ascii_lowercase+string.digits) for _ in range(5))
def setup(ctx):
    pg=ctx.new_page(); cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    return pg
def signup(pg):
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000); pg.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000)
def profile(pg, name, user, img):
    pg.click("[aria-label='Menu']"); pg.click(".menu-settings")
    pg.set_input_files("input[aria-label='Profile photo']", img); pg.click(".crop-apply"); pg.wait_for_timeout(500)
    pg.fill("#set-profile input.pf-input", name); pg.fill("input[aria-label='Username']", user)
    pg.click("button:has-text('Save profile')"); pg.wait_for_selector("text=Profile saved", timeout=60000)
    pg.click("[aria-label='Close settings']")
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    ctxA=b.new_context(viewport={"width":1440,"height":900}); ctxB=b.new_context(viewport={"width":1440,"height":900})
    A=setup(ctxA); B=setup(ctxB)
    for pg,n in ((A,'A'),(B,'B')): pg.on("console", lambda m,n=n: errs.append(n+': '+m.text[:160]) if m.type in ("error","warning") and "pubKeyCredParams" not in m.text else None)
    signup(A); profile(A, f"Alice T{tag}", f"alice{tag}", "/tmp/a.png")
    A.click("[aria-label='Menu']"); A.click(".menu-settings"); A.click("[role=tab]:has-text('Community')"); A.wait_for_selector("text=Who can see your profile")
    A.click("label.option:has-text('Public')"); A.wait_for_selector("text=Your profile is now public", timeout=60000); print("A: public")
    A.click("[aria-label='Close settings']")
    signup(B); profile(B, f"Bob T{tag}", f"bob{tag}", "/tmp/b.png")
    B.click("button[aria-label='New chat']"); B.fill("input[aria-label='Search public profiles']", f"alice{tag[:3]}")
    B.wait_for_selector(f".search-results li:has-text('Alice T{tag}')", timeout=30000)
    n=B.locator(".search-results li").count(); print("B: fuzzy search results:", n)
    B.screenshot(path="/tmp/search.png", clip={"x":60,"y":0,"width":380,"height":700})
    B.click(f".search-results li:has-text('Alice T{tag}') button:has-text('Add')")
    B.wait_for_selector(f"main[aria-label='Conversation with Alice T{tag}']", timeout=30000)
    B.fill("#draft","Hi Alice, found you in search!"); B.click("[aria-label='Send encrypted']"); B.wait_for_selector("[aria-label='Sent to mailbox']", timeout=60000)
    # A gets a request showing Bob's shared name and photo
    A.wait_for_selector(f".convo:has-text('Bob T{tag}')", timeout=60000)
    has_req=A.locator(f".convo:has-text('Bob T{tag}') .request-tag").count(); has_img=A.locator(f".convo:has-text('Bob T{tag}') img.avatar").count()
    print("A: request from", f"Bob T{tag}", "request tag:", has_req, "photo:", has_img)
    A.click(f".convo:has-text('Bob T{tag}')"); A.click(".request-banner button:has-text('Accept')")
    A.fill("#draft","Hi Bob! Accepted."); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".message.in:has-text('Accepted')", timeout=120000)
    B.wait_for_selector(f".convo:has-text('Alice T{tag}') img.avatar", timeout=30000); print("B: sees Alice's shared photo after accept")
    B.screenshot(path="/tmp/bview.png")
    # A goes private: no longer searchable
    A.click("[aria-label='Menu']"); A.click(".menu-settings"); A.click("[role=tab]:has-text('Community')"); A.click("label.option:has-text('Only people I chat with')")
    A.wait_for_selector("text=no longer public", timeout=60000)
    B.click("button[aria-label='New chat']"); B.fill("input[aria-label='Search public profiles']", f"alice{tag}")
    B.wait_for_selector("text=No public profiles match.", timeout=30000); print("B: Alice no longer found after private")
    # A deletes the account: B's app drops A's profile.
    A.click("[aria-label='Menu']"); A.click(".menu-settings"); A.click("[role=tab]:has-text('Account')"); A.click("button:has-text('Delete my account')")
    A.fill("input[aria-label='Type DELETE to confirm']", "DELETE"); A.click("button:has-text('Delete everything')")
    A.wait_for_selector("text=Sign in to OpenSocial", timeout=120000); print("A: account deleted, back at sign-in")
    B.wait_for_selector(".convo:has-text('Deleted account')", timeout=60000); print("B: contact shows 'Deleted account'")
    print("console errors:", errs[:5]); delete_accounts(b); b.close()
