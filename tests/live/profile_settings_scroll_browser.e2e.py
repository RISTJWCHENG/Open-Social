# Live test: opening Profile settings shows the Profile card at the top of the
# Settings panel and never scrolls the page (menu button stays visible).
# Run: python3 tests/live/profile_settings_scroll_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
JS="""() => ({ page: [document.documentElement.scrollTop, document.body.scrollTop, document.getElementById('root').scrollTop, document.querySelector('.app').scrollTop],
  appTop: Math.round(document.querySelector('.app').getBoundingClientRect().top),
  panelScroll: Math.round(document.querySelector('.settings-panel .settings-body')?.scrollTop ?? -1) })"""
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":620}); pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    # Short window: the sign-in card is taller than the window; its last line must be reachable.
    print("sign-in page scrolls:", pg.evaluate("() => { const p = document.querySelector('.signin-page'); return p.scrollHeight > p.clientHeight && getComputedStyle(p).overflowY === 'auto'; }"))
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000)
    print("onboarding scrolls to Skip:", pg.evaluate("() => getComputedStyle(document.querySelector('.onboard-page')).overflowY"))
    pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    pg.click("[aria-label='Menu']"); pg.click(".menu-settings"); pg.wait_for_selector("#set-profile"); pg.wait_for_timeout(500)
    print("after Profile settings:", pg.evaluate(JS), "| menu button visible:", pg.locator("[aria-label='Menu']").is_visible())
    pg.locator(".settings-panel .settings-body").evaluate("e => e.scrollTo({ top: 900 })")
    pg.click("[aria-label='Menu']"); pg.click(".menu-settings"); pg.wait_for_timeout(500)
    print("reopened after scrolling down:", pg.evaluate(JS))
    pg.screenshot(path="/tmp/ps.png"); delete_accounts(b); b.close()
