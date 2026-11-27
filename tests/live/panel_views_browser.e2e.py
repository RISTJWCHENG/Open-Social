# Live test: the right panel's switcher (profile, highlights, shared), collapse,
# and expand from the chat's top-right icons; width stays 340 px.
# Run: python3 tests/live/panel_views_browser.e2e.py  (needs /tmp/p0.jpg)
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
    A=setup(b.new_context(viewport={"width":1440,"height":860})); B=setup(b.new_context(viewport={"width":1280,"height":860}))
    A.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Unbreakable")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Unbreakable']", timeout=30000)
    A.fill("#draft", "see https://example.org/menu"); A.press("#draft", "Enter")
    with A.expect_file_chooser() as fc: A.click("button[aria-label='Attach files']")
    fc.value.set_files(["/tmp/p0.jpg"]); A.click("[aria-label='Send encrypted']"); A.wait_for_selector(".message.out img.att-media", timeout=60000)
    bub = A.locator(".message.out:has-text('example.org') .bubble"); bub.hover(); bub.locator("xpath=..").locator(".msg-action[aria-label='Message options']").click(); A.get_by_role("menuitem", name="Highlight", exact=True).click()
    A.wait_for_timeout(400)
    W = lambda: round(A.locator("aside.profile-panel").bounding_box()["width"])
    print("after highlighting:", A.get_attribute("aside.profile-panel", "aria-label"), W())
    A.click("[role=tab][aria-label='Profile']"); A.wait_for_timeout(200)
    print("profile:", A.get_attribute("aside.profile-panel", "aria-label"), W(), "| ID in details:", A.locator(".profile-details h3:has-text('OpenSocial ID')").count())
    A.locator("aside.profile-panel").screenshot(path="/tmp/pv-profile.png")
    A.click("[role=tab][aria-label='Media, files and links']"); A.wait_for_timeout(200)
    print("shared:", A.get_attribute("aside.profile-panel", "aria-label"), W(), "| tabs:", A.locator("aside.profile-panel [role=tab][id^='tab-']").all_inner_texts(), "| media:", A.locator("aside.profile-panel .media-grid .attachment").count())
    A.click("aside.profile-panel [role=tab]#tab-links"); print("links:", A.locator("aside.profile-panel .link-list a").all_inner_texts())
    A.locator("aside.profile-panel").screenshot(path="/tmp/pv-shared.png")
    A.click("button[aria-label='Collapse panel']"); A.wait_for_timeout(300)
    print("collapsed: panel", A.locator("aside.profile-panel").count(), "| expand in toolbar:", A.locator(".chat-toolbar button[aria-label='Expand panel']").count())
    A.click(".chat-toolbar button[aria-label='Expand panel']"); A.wait_for_timeout(300)
    print("expanded back to:", A.get_attribute("aside.profile-panel", "aria-label"), "| expand button gone:", A.locator(".chat-toolbar button[aria-label='Expand panel']").count() == 0)
    A.click("[role=tab][aria-label='Profile']"); A.click("aside.profile-panel button[aria-label='Search this chat']")
    print("profile Search opens chat search:", A.locator("input[aria-label='Search this chat']").count())
    print("errors:", errs[:3]); delete_accounts(b); b.close()
