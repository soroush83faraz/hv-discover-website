/**
 * /contact form (loaded by the contact page). forms.ts checks the fields inline; then the
 * message goes out through lib/submit.ts (api/CLIENT.md: token fetched at page load, JSON POST
 * to /api/contact.php). On success the sent box ([data-form-done], #message-sent) shows in
 * place with the reply address and the reference, and the form is cleared; API errors go to
 * the same inline errors and alert.
 * Without JavaScript the API redirects to /contact?ref=…#message-sent; CSS (:target) shows the
 * box, and when scripts do run on that URL the reference is filled in here.
 */
import { attachForm, isBusy, setBusy, showServerErrors } from './forms';
import { REF_RE, submitForm, tokens } from './lib/submit';

const form = document.getElementById('contact-form');

if (form instanceof HTMLFormElement) {
  const done = form.querySelector<HTMLElement>('[data-form-done]');
  const contactTokens = tokens('contact');
  void contactTokens.load(); // early, so min_wait has passed by submit time

  const value = (name: string): string => {
    const f = form.elements.namedItem(name);
    return f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement ? f.value.trim() : '';
  };

  const showDone = (email: string, ref: string): void => {
    if (!done) return;
    const put = (sel: string, wrapSel: string, text: string): void => {
      const out = done.querySelector(sel);
      if (out) out.textContent = text;
      const wrap = done.querySelector<HTMLElement>(wrapSel);
      if (wrap) wrap.hidden = !text;
    };
    put('[data-done-email]', '[data-done-email-wrap]', email);
    put('[data-done-ref]', '[data-done-ref-wrap]', ref);
    done.hidden = false;
  };

  const send = async (): Promise<void> => {
    done?.setAttribute('hidden', '');
    setBusy(form, true);
    const res = await submitForm('contact', contactTokens, () => ({
      name: value('name'),
      email: value('email'),
      company: value('company'),
      message: value('message'),
      website: value('website'),
    }));
    setBusy(form, false);
    if (!res.ok) {
      showServerErrors(form, res.errors);
      return;
    }
    showDone(value('email'), res.reference);
    form.reset();
    done?.focus();
    void contactTokens.load(); // a token is single use: have one ready for a next message
  };

  attachForm(form, {
    onValid: () => {
      if (!isBusy(form)) void send();
    },
  });

  // back from the no-JavaScript post: /contact?ref=…#message-sent
  const ref = new URLSearchParams(location.search).get('ref') ?? '';
  if (REF_RE.test(ref)) showDone('', ref);
}
