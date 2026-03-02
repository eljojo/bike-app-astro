import { useState } from 'preact/hooks';

export default function InviteCodeGenerator() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function generateCode() {
    setError('');
    setLoading(true);
    setCopied(false);

    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate invite code');
      }

      const data = await res.json();
      setCode(data.code);
    } catch (err: any) {
      setError(err.message || 'Failed to generate invite code');
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}/register?code=${code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div class="invite-generator">
      <button
        type="button"
        class="btn-primary"
        onClick={generateCode}
        disabled={loading}
      >
        {loading ? 'Generating...' : 'Generate invite code'}
      </button>

      {error && <div class="auth-error">{error}</div>}

      {code && (
        <div class="invite-result">
          <code class="invite-code">{code}</code>
          <button type="button" class="btn-copy" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
      )}
    </div>
  );
}
