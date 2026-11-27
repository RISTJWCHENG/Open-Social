# Live test of the address book: invite link + QR, add from an invite, rename,
# favourite, view profile, active dot, remove (confirm), block and unblock.
# Run: python3 tests/live/contacts_full_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts, my_principal
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
def setup(ctx):
    pg=ctx.new_page(); cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    return pg
def signup(pg, url=URL):
    pg.goto(url, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    p=my_principal(pg); return p
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    A=setup(b.new_context(viewport={"width":1280,"height":860})); B=setup(b.new_context(viewport={"width":1280,"height":860})); C=setup(b.new_context(viewport={"width":1280,"height":860}))
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pA=signup(A); pC=signup(C)
    # Alice shares her invite link; Bob opens it in a fresh browser.
    A.click("button[aria-label='Contacts']"); A.click("button[aria-label='Add']"); A.click("[role=menuitem]:has-text('Add person')")
    link=A.inner_text(".share-link"); print("invite link:", link.replace(pA, "<alice-id>"), "| QR:", A.locator("svg[aria-label='QR code to add you on OpenSocial']").count())
    A.locator(".share-card").screenshot(path="/tmp/share.png")
    A.click("button[aria-label='Close add person']")
    signup(B, link)
    B.wait_for_selector("section[aria-label='Contacts'] form[aria-label='Add a contact']", timeout=30000)
    print("Bob after opening the link: id filled:", B.input_value("input[placeholder='xxxxx-xxxxx-…-xxx']") == pA, "| hash cleared:", B.evaluate("location.hash") == "")
    B.fill("input[placeholder='e.g. Alice from work']", "Alice"); B.click("button:has-text('Add to contacts')"); B.wait_for_selector("text=Alice is now in your contacts.")
    B.click("button:has-text('Say hello')"); B.fill("#draft", "hello from the invite"); B.click("[aria-label='Send encrypted']")
    # Alice: Bob is a request; accept. Carol added by ID.
    A.click("button[aria-label='Contacts']"); A.wait_for_selector("section[aria-label='Requests'] .contact-row", timeout=90000)
    A.click("section[aria-label='Requests'] button:has-text('Accept')"); A.wait_for_timeout(500)
    A.click("button[aria-label='Add']"); A.click("[role=menuitem]:has-text('Add person')"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pC); A.fill("input[placeholder='e.g. Alice from work']", "Carol")
    A.click("button:has-text('Add to contacts')"); A.wait_for_selector("text=Carol is now in your contacts."); A.click("button[aria-label='Close add person']")
    names=lambda: A.locator("section[aria-label='Friends'] .contact-name").all_inner_texts()
    print("friends:", names())
    rowOf=lambda n: A.locator(f"section[aria-label='Friends'] .contact-row:has(.contact-name:text-is('{n}'))")
    # Rename Bob.
    bob=[n for n in names() if n != 'Carol'][0]
    rowOf(bob).hover(); rowOf(bob).locator(".contact-more").click(); A.click("[role=menuitem]:has-text('Rename')")
    A.fill(".dialog input", "Bobby"); A.keyboard.press("Enter"); A.wait_for_timeout(400); print("after rename:", names())
    rowOf("Bobby").hover(); rowOf("Bobby").locator(".contact-more").click(); A.click("[role=menuitem]:has-text('Add to Favorites')"); A.wait_for_timeout(300)
    print("favorites:", A.locator("section[aria-label='Favorites'] .contact-name").all_inner_texts(), "| active dots:", A.locator("section[aria-label='Friends'] .active-dot").count())
    A.screenshot(path="/tmp/contacts-full.png", clip={"x":0,"y":0,"width":440,"height":560})
    # View profile.
    rowOf("Bobby").hover(); rowOf("Bobby").locator(".contact-more").click(); A.click("[role=menuitem]:has-text('View profile')")
    A.wait_for_selector("aside.profile-panel", timeout=10000); print("view profile opened:", A.inner_text("aside.profile-panel h2"))
    # Remove Carol, block and unblock.
    A.click("button[aria-label='Contacts']"); rowOf("Carol").hover(); rowOf("Carol").locator(".contact-more").click(); A.click("[role=menuitem]:has-text('Remove contact')")
    print("confirm:", A.inner_text(".dialog h2")); A.click(".dialog button:has-text('Remove')"); A.wait_for_timeout(400); print("after remove:", names())
    rowOf("Bobby").hover(); rowOf("Bobby").locator(".contact-more").click(); A.click("[role=menuitem]:has-text('Block')"); A.click(".dialog button:has-text('Block')"); A.wait_for_timeout(400)
    print("after block: friends", names(), "| blocked heading:", A.inner_text("section[aria-label='Blocked'] .contacts-toggle"))
    A.click("section[aria-label='Blocked'] .contacts-toggle"); A.click("section[aria-label='Blocked'] button:has-text('Unblock')"); A.wait_for_timeout(400)
    print("after unblock: blocked section:", A.locator("section[aria-label='Blocked']").count())
    print("errors:", errs[:3]); delete_accounts(b); b.close()
