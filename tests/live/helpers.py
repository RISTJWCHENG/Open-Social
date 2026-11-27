# Shared steps for the live browser tests: create a throwaway account through
# the sign-up dialog, and delete the accounts a test created through the app's
# own Settings > Account > Delete account flow, so test runs leave nothing
# behind in the identity and profiles canisters.

import secrets


def create_account(pg, username=None):
    """Opens the sign-up dialog and creates an account with a new passkey."""
    pg.click("text=Create your OpenSocial account")
    pg.fill("input[placeholder='Choose a username']", username or "t_" + secrets.token_hex(6))
    pg.check("label.signup-terms input")
    pg.click("button:has-text('Create account')")


def delete_account(pg):
    """Deletes the account signed in on this page; does nothing if none is."""
    try:
        if pg.is_closed() or pg.locator("[aria-label='Menu']").count() == 0:
            return
        # The menu is hidden at phone widths: use a desktop window to reach it.
        pg.set_viewport_size({"width": 1280, "height": 860})
        pg.click("[aria-label='Menu']")
        pg.click(".menu-settings")
        pg.wait_for_selector("aside.settings-panel", timeout=20000)
        pg.click("[role=tab]:has-text('Account')")
        pg.click("text=Delete my account…")
        pg.fill("input[aria-label='Type DELETE to confirm']", "DELETE")
        pg.click("button:has-text('Delete everything')")
        pg.wait_for_selector("text=Sign in to OpenSocial", timeout=120000)
    except Exception as e:  # cleanup must never hide the test's own result
        print("cleanup: could not delete a test account:", str(e)[:160])


def delete_accounts(browser):
    """Deletes the account of every open page, one page per browser context."""
    for ctx in browser.contexts:
        for pg in ctx.pages:
            if not pg.is_closed() and pg.locator("[aria-label='Menu']").count() > 0:
                delete_account(pg)
                break


def my_principal(pg):
    """The signed-in account's OpenSocial ID, from the notes-to-yourself chat's profile panel."""
    pg.click("button[aria-label$='notes to yourself']")
    pid = pg.inner_text(".profile-details .principal").strip()
    pg.click("button[aria-label='Chats']")
    return pid
