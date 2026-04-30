// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Key: use class not className, useHydrated required, all styles in admin.scss.
import { useState, useRef } from 'preact/hooks';
import WizardLayout, { WizardNav } from './WizardLayout';
import { useFormValidation } from './useFormValidation';
import { useEditorForm } from './useEditorForm';
import { bindText } from './field-helpers';
import PhotoField from './PhotoField';
import CoverPhotoField, { type CoverItem } from './CoverPhotoField';
import MarkdownEditor from './MarkdownEditor';
import MapPinPicker from './MapPinPicker';
import { useWizardSkips, buildCelebrateUrl } from './wizard-helpers';
import { isGoogleMapsUrl } from '../../lib/google-maps-url';
import { SOCIAL_PLATFORMS, type SocialLink } from '@/lib/social-links';
import { slugify } from '../../lib/slug';
import type { OrganizerUpdate } from '../../views/api/organizer-save';

type Mode = 'community' | 'bike-shop' | null;

const COMMUNITY_STOPS = ['Profile', 'Online', 'About', 'Go Live'];
const BIKE_SHOP_STOPS = ['Profile', 'Contact', 'Location', 'About', 'Go Live'];

interface Props {
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  userRole?: string;
  showLicenseNotice?: boolean;
  guestLabel?: string;
  tagTranslations?: Record<string, Record<string, string>>;
  knownTags?: string[];
  defaultLocale?: string;
  cityName?: string;
  cityCenter?: [number, number];
  cityBounds?: { north: number; south: number; east: number; west: number };
}

export default function CommunityWizard({
  cdnUrl,
  userRole,
  showLicenseNotice,
  guestLabel,
  cityName,
  cityCenter,
}: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const { step, setStep, skippedSteps, skipStep } = useWizardSkips();

  // --- Shared fields (Profile step) ---
  const [name, setName] = useState('');
  const [photoKey, setPhotoKey] = useState('');
  const [photoContentType, setPhotoContentType] = useState('');
  const [photoWidth, setPhotoWidth] = useState(0);
  const [photoHeight, setPhotoHeight] = useState(0);
  const [coverItem, setCoverItem] = useState<CoverItem | undefined>(undefined);

  // --- Community: Online step ---
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);

  // --- Bike shop: Contact step ---
  const [website, setWebsite] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // --- Bike shop: Location step ---
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [prefilling, setPrefilling] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const lastPrefillQuery = useRef<string>('');
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [address, setAddress] = useState('');

  // --- About step ---
  const [body, setBody] = useState('');

  function updateLocation(latitude: number, longitude: number) {
    setLat(latitude);
    setLng(longitude);
  }

  async function handlePrefill() {
    const query = googleMapsUrl.trim();
    if (!query || query === lastPrefillQuery.current) return;
    lastPrefillQuery.current = query;
    setPrefilling(true);
    editor.setError('');
    try {
      const res = await fetch('/api/places/prefill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) {
        editor.setError(data.error || 'Prefill failed');
        return;
      }
      if (data.name && !name.trim()) setName(data.name);
      if (data.address) setAddress(data.address);
      if (data.phone && !phone.trim()) setPhone(data.phone);
      if (data.website && !website.trim()) setWebsite(data.website);
      if (data.lat && data.lng) {
        updateLocation(data.lat, data.lng);
      }
    } catch {
      editor.setError('Prefill request failed');
    } finally {
      setPrefilling(false);
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text')?.trim();
    if (text && isGoogleMapsUrl(text)) {
      setTimeout(() => handlePrefill(), 0);
    }
  }

  function handleBlur() {
    const query = googleMapsUrl.trim();
    if (query && isGoogleMapsUrl(query)) {
      handlePrefill();
    }
  }

  // Social links helpers (community Online step)
  function addSocialLink() {
    setSocialLinks(prev => [...prev, { platform: 'instagram', url: '' }]);
  }

  function removeSocialLink(index: number) {
    setSocialLinks(prev => prev.filter((_, i) => i !== index));
  }

  function updateSocialLink(index: number, field: 'platform' | 'url', value: string) {
    setSocialLinks(prev => prev.map((link, i) =>
      i === index ? { ...link, [field]: value } : link,
    ));
  }

  // Validation
  const { validate } = useFormValidation([
    { field: 'community-name', check: () => !name.trim(), message: 'Name is required' },
    ...(mode === 'bike-shop' ? [
      { field: '', check: () => !lat && !lng, message: 'Click on the map to set a location, or use a Google Maps link' },
    ] : []),
  ]);

  const editor = useEditorForm({
    apiBase: '/api/organizers',
    contentId: null,
    userRole,
    validate,
    deps: [name, photoKey, socialLinks, website, email, phone, lat, lng, address, body, mode, coverItem],
    buildPayload: () => {
      const allSocialLinks: SocialLink[] = [];

      if (mode === 'bike-shop') {
        if (email.trim()) allSocialLinks.push({ platform: 'email', url: email.trim() });
        if (phone.trim()) allSocialLinks.push({ platform: 'telephone', url: phone.trim() });
        if (website.trim()) allSocialLinks.push({ platform: 'website', url: website.trim() });
      } else {
        allSocialLinks.push(...socialLinks.filter(l => l.url.trim()));
      }

      const payload: OrganizerUpdate = {
        frontmatter: {
          name,
          tags: mode === 'bike-shop' ? ['bike-shop'] : [],
          ...(photoKey && {
            photo_key: photoKey,
            ...(photoContentType && { photo_content_type: photoContentType }),
            ...(photoWidth && { photo_width: photoWidth }),
            ...(photoHeight && { photo_height: photoHeight }),
          }),
          ...(allSocialLinks.length > 0 && { social_links: allSocialLinks }),
          ...(coverItem && {
            media: [{
              key: coverItem.key,
              type: 'photo' as const,
              ...(coverItem.width && { width: coverItem.width }),
              ...(coverItem.height && { height: coverItem.height }),
              cover: true,
            }],
          }),
        },
        body,
      };

      const result = payload as unknown as Record<string, unknown>;

      if (mode === 'bike-shop' && lat && lng) {
        result['place'] = {
          name,
          category: 'bike-shop',
          lat,
          lng,
          ...(address && { address }),
          ...(phone.trim() && { phone: phone.trim() }),
          ...(website.trim() && { website: website.trim() }),
        };
      }

      return result;
    },
    onSuccess: (result) => {
      const slug = result?.id || slugify(name);
      window.location.href = buildCelebrateUrl('community', slug, skippedSteps);
    },
  });

  // --- Step renderers ---

  function renderFork() {
    return (
      <div class="wizard-welcome">
        <h1 class="wizard-welcome-heading">
          What are you adding?
          {cityName ? ` to ${cityName}` : ''}
        </h1>
        <p class="wizard-welcome-body">
          Choose what best describes what you're adding.
        </p>
        <div class="wizard-fork">
          <button
            type="button"
            class="wizard-fork-option"
            onClick={() => { setMode('community'); setStep(1); }}
          >
            <div class="wizard-fork-emoji">🚲</div>
            <div class="wizard-fork-title">A community or cycling group</div>
            <div class="wizard-fork-desc">A club, crew, or group of riders</div>
          </button>
          <button
            type="button"
            class="wizard-fork-option"
            onClick={() => { setMode('bike-shop'); setStep(1); }}
          >
            <div class="wizard-fork-emoji">🔧</div>
            <div class="wizard-fork-title">A bike shop</div>
            <div class="wizard-fork-desc">A shop where cyclists buy gear or get repairs</div>
          </button>
        </div>
      </div>
    );
  }

  function renderProfile() {
    return (
      <>
        <h2 class="wizard-step-heading">Profile</h2>
        <div class="auth-form">
          <div class="form-field">
            <label for="community-name">Name</label>
            <input id="community-name" type="text" {...bindText(name, setName)} placeholder={mode === 'bike-shop' ? 'e.g. Velo Espresso' : 'e.g. Critical Mass Ottawa'} />
          </div>
          <div class="form-field">
            <PhotoField
              photoKey={photoKey}
              cdnUrl={cdnUrl}
              label="Profile picture"
              onPhotoChange={(key, contentType, width, height) => {
                setPhotoKey(key);
                setPhotoContentType(contentType);
                setPhotoWidth(width || 0);
                setPhotoHeight(height || 0);
              }}
            />
            <p class="form-field-hint">This will be their profile picture on the wiki.</p>
          </div>
          <div class="form-field">
            <CoverPhotoField
              cover={coverItem}
              cdnUrl={cdnUrl}
              onCoverChange={setCoverItem}
            />
            <p class="form-field-hint">A wide photo for the top of the community page (optional).</p>
          </div>
        </div>
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => { setStep(0); setMode(null); }}
          onNext={() => {
            if (!name.trim()) { editor.setError('Name is required'); return; }
            editor.setError('');
            setStep(2);
          }}
          nextDisabled={!name.trim()}
        />
      </>
    );
  }

  function renderCommunityOnline() {
    return (
      <>
        <h2 class="wizard-step-heading">Online</h2>
        <p class="wizard-step-subheading">
          The more links you add, the easier it is for people to find them.
        </p>
        <div class="auth-form">
          <div class="form-field">
            {socialLinks.map((link, index) => (
              <div class="social-link-row" key={index}>
                <select
                  value={link.platform}
                  onChange={(e) => updateSocialLink(index, 'platform', (e.target as HTMLSelectElement).value)}
                >
                  {SOCIAL_PLATFORMS.map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
                <input
                  type="url"
                  value={link.url}
                  placeholder="https://..."
                  onInput={(e) => updateSocialLink(index, 'url', (e.target as HTMLInputElement).value)}
                />
                <button type="button" class="btn-remove-social" onClick={() => removeSocialLink(index)}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" class="btn-secondary" onClick={addSocialLink}>
              + Add social link
            </button>
          </div>
        </div>
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => setStep(1)}
          onNext={() => { editor.setError(''); setStep(3); }}
          skipLabel="Skip for now"
          onSkip={() => skipStep('online', 3)}
        />
      </>
    );
  }

  function renderBikeShopContact() {
    return (
      <>
        <h2 class="wizard-step-heading">Contact</h2>
        <p class="wizard-step-subheading">
          Help people get in touch.
        </p>
        <div class="auth-form">
          <div class="form-field">
            <label for="shop-website">Website</label>
            <input id="shop-website" type="url" {...bindText(website, setWebsite)} placeholder="https://..." />
          </div>
          <div class="form-field">
            <label for="shop-email">Email</label>
            <input id="shop-email" type="email" {...bindText(email, setEmail)} placeholder="hello@example.com" />
          </div>
          <div class="form-field">
            <label for="shop-phone">Phone</label>
            <input id="shop-phone" type="tel" {...bindText(phone, setPhone)} placeholder="+1 613 555 0100" />
          </div>
        </div>
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => setStep(1)}
          onNext={() => { editor.setError(''); setStep(3); }}
          skipLabel="Skip for now"
          onSkip={() => skipStep('contact', 3)}
        />
      </>
    );
  }

  function renderBikeShopLocation() {
    return (
      <>
        <h2 class="wizard-step-heading">Location</h2>
        <p class="wizard-step-subheading">
          Paste a Google Maps link to fill in the location automatically.
        </p>
        <div class="auth-form">
          <div class="form-field">
            <label for="shop-gmaps">Google Maps link</label>
            <p class="form-field-hint">Paste a Google Maps link and we'll auto-fill the address and coordinates.</p>
            <div class="prefill-row">
              <input
                id="shop-gmaps"
                type="text"
                value={googleMapsUrl}
                placeholder="https://maps.google.com/..."
                onInput={(e) => setGoogleMapsUrl((e.target as HTMLInputElement).value)}
                onPaste={handlePaste}
                onBlur={handleBlur}
              />
              <button
                type="button"
                class="btn-secondary btn-prefill"
                onClick={handlePrefill}
                disabled={prefilling || !googleMapsUrl.trim()}
              >
                {prefilling ? 'Loading...' : 'Prefill'}
              </button>
            </div>
          </div>

          {!showMap && (
            <div class="creator-divider"><span>or</span></div>
          )}

          {!showMap ? (
            <button
              type="button"
              class="btn-secondary"
              onClick={() => setShowMap(true)}
            >
              Place a pin manually
            </button>
          ) : (
            <MapPinPicker
              center={cityCenter ?? [45.42, -75.69]}
              lat={lat}
              lng={lng}
              onChange={updateLocation}
              onAddressChange={setAddress}
            />
          )}
        </div>
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => setStep(2)}
          onNext={() => { editor.setError(''); setStep(4); }}
          skipLabel="Skip for now"
          onSkip={() => skipStep('location', 4)}
        />
      </>
    );
  }

  function renderAbout() {
    const backStep = mode === 'bike-shop' ? 3 : 2;
    const nextStep = mode === 'bike-shop' ? 5 : 4;
    return (
      <>
        <h2 class="wizard-step-heading">About</h2>
        <p class="wizard-step-subheading">
          {mode === 'bike-shop'
            ? 'What should cyclists know about this shop?'
            : 'Tell people what this group is about.'}
        </p>
        <div class="auth-form">
          <MarkdownEditor id="community-body" value={body} onChange={setBody} rows={8} />
        </div>
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => setStep(backStep)}
          onNext={() => { editor.setError(''); setStep(nextStep); }}
          skipLabel="Skip for now"
          onSkip={() => skipStep('about', nextStep)}
        />
      </>
    );
  }

  function renderGoLive() {
    const backStep = mode === 'bike-shop' ? 4 : 3;
    return (
      <>
        <h2 class="wizard-step-heading">Ready to go live?</h2>
        <p class="wizard-step-subheading">Here's what you're adding.</p>
        <div class="auth-form">
          <table class="extraction-table">
            <tbody>
              {name && (
                <tr>
                  <td class="field-name">name</td>
                  <td>{name}</td>
                </tr>
              )}
              {mode && (
                <tr>
                  <td class="field-name">type</td>
                  <td>{mode === 'bike-shop' ? 'Bike shop' : 'Community'}</td>
                </tr>
              )}
              {mode === 'community' && socialLinks.filter(l => l.url.trim()).length > 0 && (
                <tr>
                  <td class="field-name">links</td>
                  <td>{socialLinks.filter(l => l.url.trim()).length} social link{socialLinks.filter(l => l.url.trim()).length !== 1 ? 's' : ''}</td>
                </tr>
              )}
              {mode === 'bike-shop' && website && (
                <tr>
                  <td class="field-name">website</td>
                  <td>{website}</td>
                </tr>
              )}
              {mode === 'bike-shop' && email && (
                <tr>
                  <td class="field-name">email</td>
                  <td>{email}</td>
                </tr>
              )}
              {mode === 'bike-shop' && phone && (
                <tr>
                  <td class="field-name">phone</td>
                  <td>{phone}</td>
                </tr>
              )}
              {mode === 'bike-shop' && (lat !== 0 || lng !== 0) && (
                <tr>
                  <td class="field-name">location</td>
                  <td>{lat.toFixed(6)}, {lng.toFixed(6)}</td>
                </tr>
              )}
              {body && (
                <tr>
                  <td class="field-name">about</td>
                  <td>added</td>
                </tr>
              )}
              {photoKey && (
                <tr>
                  <td class="field-name">photo</td>
                  <td>uploaded</td>
                </tr>
              )}
              {coverItem && (
                <tr>
                  <td class="field-name">cover photo</td>
                  <td>uploaded</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {userRole === 'guest' && guestLabel && <p class="editor-guest-label">{guestLabel}</p>}
        {showLicenseNotice && (
          <p class="editor-license-notice">
            Your contribution will be shared under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
            {' '}<a href="https://whereto.bike/about/licensing/" target="_blank" rel="noopener">What does this mean?</a>
          </p>
        )}
        {editor.error && <div class="auth-error">{editor.error}</div>}
        <WizardNav
          onBack={() => setStep(backStep)}
          onNext={editor.save}
          nextLabel={editor.saving ? 'Saving...' : 'Save'}
          nextDisabled={editor.saving}
        />
      </>
    );
  }

  const stops = mode === 'bike-shop' ? BIKE_SHOP_STOPS : COMMUNITY_STOPS;

  // Step renderers for community path: 0=fork, 1=profile, 2=online, 3=about, 4=go live
  // Step renderers for bike-shop path: 0=fork, 1=profile, 2=contact, 3=location, 4=about, 5=go live
  function renderStep() {
    if (step === 0) return renderFork();
    if (step === 1) return renderProfile();
    if (mode === 'community') {
      if (step === 2) return renderCommunityOnline();
      if (step === 3) return renderAbout();
      if (step === 4) return renderGoLive();
    }
    if (mode === 'bike-shop') {
      if (step === 2) return renderBikeShopContact();
      if (step === 3) return renderBikeShopLocation();
      if (step === 4) return renderAbout();
      if (step === 5) return renderGoLive();
    }
    return renderFork();
  }

  return (
    <div ref={editor.hydratedRef}>
      <WizardLayout stops={stops} currentStep={step} onStepChange={setStep}>
        {renderStep()}
      </WizardLayout>
    </div>
  );
}
