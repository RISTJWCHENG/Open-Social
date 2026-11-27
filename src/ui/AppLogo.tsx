import logoUrl from './assets/open-social-logo.png';

/** The OpenSocial logo. Decorative: the page heading names the app. */
export function AppLogo() {
  return <img className="app-logo" src={logoUrl} alt="" width={56} height={54} />;
}
