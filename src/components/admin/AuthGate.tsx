import { useState } from 'preact/hooks';

interface Props {
  returnTo: string;
  blogMode?: boolean;
  locale?: string;
}

const translations: Record<string, Record<string, string>> = {
  en: {
    reassurance: 'Every edit can be undone, and guest edits are published without your name.',
    guestButton: 'Continue as guest',
    guestHint: 'No email, no account. Just start editing.',
    signin: 'Already have an account? Sign in',
    register: 'Want credit for your contributions? Create account',
    howEditing: 'How does editing work?',
    settingUp: 'Setting up...',
    failed: 'Failed to continue as guest',
  },
  fr: {
    reassurance: 'Chaque modification peut \u00eatre annul\u00e9e, et les contributions anonymes sont publi\u00e9es sans votre nom.',
    guestButton: 'Continuer en tant qu\u2019invit\u00e9',
    guestHint: 'Pas de courriel, pas de compte. Commencez \u00e0 modifier.',
    signin: 'Vous avez d\u00e9j\u00e0 un compte\u00a0? Connectez-vous',
    register: 'Vous voulez \u00eatre cr\u00e9dit\u00e9 pour vos contributions\u00a0? Cr\u00e9ez un compte',
    howEditing: 'Comment fonctionne la modification\u00a0?',
    settingUp: 'Pr\u00e9paration...',
    failed: 'Impossible de continuer en tant qu\u2019invit\u00e9',
  },
  es: {
    reassurance: 'Cada edici\u00f3n se puede deshacer, y las contribuciones an\u00f3nimas se publican sin tu nombre.',
    guestButton: 'Continuar como invitado',
    guestHint: 'Sin correo, sin cuenta. Solo empieza a editar.',
    signin: '\u00bfYa tienes una cuenta? Inicia sesi\u00f3n',
    register: '\u00bfQuieres cr\u00e9dito por tus contribuciones? Crea una cuenta',
    howEditing: '\u00bfC\u00f3mo funciona la edici\u00f3n?',
    settingUp: 'Preparando...',
    failed: 'No se pudo continuar como invitado',
  },
};

function tr(locale: string | undefined, key: string): string {
  const fallback = defaultLocale();
  const lang = locale || fallback;
  return translations[lang]?.[key] || translations[fallback]?.[key] || key;
}

export default function AuthGate({ returnTo, blogMode, locale }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGuest() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = tr(locale, 'failed');
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }
      window.location.href = returnTo;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tr(locale, 'failed'));
    } finally {
      setLoading(false);
    }
  }

  if (blogMode) {
    return (
      <div class="gate-options">
        {error && <div class="auth-error">{error}</div>}
        <a href={`/login?returnTo=${encodeURIComponent(returnTo)}`} class="btn-primary gate-btn">
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div class="gate-options gate-options--guest-first">
      <p class="gate-reassurance">{tr(locale, 'reassurance')}</p>

      {error && <div class="auth-error">{error}</div>}

      <button
        type="button"
        class="btn-primary gate-btn gate-btn--primary"
        onClick={handleGuest}
        disabled={loading}
      >
        {loading ? tr(locale, 'settingUp') : tr(locale, 'guestButton')}
      </button>
      <p class="gate-guest-hint">{tr(locale, 'guestHint')}</p>

      <div class="gate-secondary-options">
        <a href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
          {tr(locale, 'signin')}
        </a>
        <a href={`/register?returnTo=${encodeURIComponent(returnTo)}`}>
          {tr(locale, 'register')}
        </a>
      </div>

      <a href="/about" class="gate-how-link">{tr(locale, 'howEditing')}</a>
    </div>
  );
}
