/**
 * Reusable WiseGrade transactional email templates.
 *
 * Every template returns a subject, a responsive HTML body and a plain-text
 * alternative. Brand colours match the web application (`frontend/src/index.css`)
 * and all links are built from environment configuration by the caller, never
 * hardcoded. No template embeds SMTP credentials, session tokens or audit data.
 */

export type EmailTemplateName =
  | 'admin-welcome'
  | 'admin-verified'
  | 'admin-verification-resend'
  | 'teacher-credentials'
  | 'teacher-first-login'
  | 'subject-assignment'
  | 'subject-code-replaced'
  | 'subject-code-expired'
  | 'smtp-test'

export interface EmailDataMap {
  'admin-welcome': {
    firstName: string
    schoolName: string
    verificationUrl: string
    expiresAt: string
    expiryHours: number
  }
  'admin-verified': {
    firstName: string
    schoolName: string
    dashboardUrl: string
  }
  'admin-verification-resend': {
    firstName: string
    schoolName: string
    verificationUrl: string
    expiresAt: string
    expiryHours: number
  }
  'teacher-credentials': {
    firstName: string
    schoolName: string
    className: string
    loginEmail: string
    temporaryPassword: string
    loginUrl: string
  }
  'teacher-first-login': {
    firstName: string
    schoolName: string
    loginEmail: string
    changePasswordUrl: string
  }
  'subject-assignment': {
    firstName: string
    schoolName: string
    className: string
    subjectName: string
    accessCode: string
    accessCodeUrl: string
    expiresAt: string
  }
  'subject-code-replaced': {
    firstName: string
    schoolName: string
    className: string
    subjectName: string
    accessCode: string
    accessCodeUrl: string
    expiresAt: string
  }
  'subject-code-expired': {
    firstName: string
    schoolName: string
    className: string
    subjectName: string
    expiredAt: string
    accessCodeUrl: string
  }
  'smtp-test': {
    recipientName: string
    sentAt: string
    smtpHost: string
  }
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const BRAND = {
  navy: '#174a9c',
  blue: '#0785ef',
  green: '#22b83d',
  gold: '#f5aa00',
  text: '#172033',
  muted: '#64748b',
  light: '#f7f9fc',
  border: '#e2e8f0',
} as const

const PRODUCT_NAME = 'WiseGrade'
const TAGLINE = 'Smarter Reports. Better Learning.'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface LayoutInput {
  preheader: string
  heading: string
  intro: string
  bodyHtml: string
  bodyText: string
  footer?: string
}

function layout(input: LayoutInput): { html: string; text: string } {
  const footer = input.footer ?? `You are receiving this email because your ${PRODUCT_NAME} account was created or updated.`

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(input.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.light};color:${BRAND.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.light};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:${BRAND.navy};padding:24px 28px;">
                <div style="font-size:22px;line-height:1.2;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">${PRODUCT_NAME}</div>
                <div style="margin-top:4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#c7dbff;">${TAGLINE}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 8px 28px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:${BRAND.navy};">${escapeHtml(input.heading)}</h1>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:1.65;color:${BRAND.text};">${escapeHtml(input.intro)}</p>
                ${input.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px 28px;border-top:1px solid ${BRAND.border};">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(footer)}</p>
                <p style="margin:8px 0 0 0;font-size:12px;line-height:1.6;color:${BRAND.muted};">${PRODUCT_NAME} &middot; ${TAGLINE}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = `${PRODUCT_NAME}
${TAGLINE}

${input.heading}

${input.intro}

${input.bodyText}

--
${footer}
${PRODUCT_NAME} - ${TAGLINE}`

  return { html, text }
}

function actionButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px 0;">
    <tr>
      <td style="border-radius:12px;background:${BRAND.blue};">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`
}

function detailTable(rows: Array<[string, string]>): string {
  const cells = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:8px 0;font-size:13px;color:${BRAND.muted};width:38%;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:${BRAND.text};vertical-align:top;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-top:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};">${cells}</table>`
}

function codePanel(code: string): string {
  return `<div style="margin:0 0 20px 0;padding:16px;border:1px dashed ${BRAND.blue};border-radius:12px;background:${BRAND.light};text-align:center;">
    <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:8px;">Access code</div>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;line-height:1.5;font-weight:700;color:${BRAND.navy};word-break:break-all;">${escapeHtml(code)}</div>
  </div>`
}

function passwordPanel(password: string): string {
  return `<div style="margin:0 0 20px 0;padding:16px;border:1px solid ${BRAND.border};border-radius:12px;background:${BRAND.light};">
    <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px;">Temporary password</div>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:16px;font-weight:700;color:${BRAND.navy};word-break:break-all;">${escapeHtml(password)}</div>
  </div>`
}

function warningBox(message: string): string {
  return `<div style="margin:0 0 20px 0;padding:14px 16px;border-left:4px solid ${BRAND.gold};border-radius:8px;background:#fffaeb;font-size:14px;line-height:1.6;color:${BRAND.text};">${escapeHtml(message)}</div>`
}

function subjectDetails(data: EmailDataMap['subject-assignment']): string {
  return detailTable([
    ['School', data.schoolName],
    ['Class', data.className],
    ['Subject', data.subjectName],
    ['Access code expires', data.expiresAt],
  ])
}

function subjectText(data: EmailDataMap['subject-assignment']): string {
  return `School: ${data.schoolName}
Class: ${data.className}
Subject: ${data.subjectName}
Access code: ${data.accessCode}
Expires: ${data.expiresAt}

Enter the code at ${data.accessCodeUrl} to open your subject workspace.`
}

export function renderTemplate<T extends EmailTemplateName>(
  template: T,
  data: EmailDataMap[T],
): RenderedEmail {
  switch (template) {
    case 'admin-welcome':
    case 'admin-verification-resend': {
      const payload = data as EmailDataMap['admin-welcome']
      const isResend = template === 'admin-verification-resend'
      const heading = isResend
        ? 'Your new verification link'
        : `Welcome to ${PRODUCT_NAME}, ${payload.firstName}`
      const intro = isResend
        ? `A new verification link for ${payload.schoolName} has been created. The previous link is no longer valid.`
        : `Your school ${payload.schoolName} has been created. Verify your email address to finish setting up your administrator account.`
      const result = layout({
        preheader: `Verify your ${PRODUCT_NAME} administrator email address.`,
        heading,
        intro,
        bodyHtml: `${actionButton('Verify email address', payload.verificationUrl)}
          <p style="margin:0 0 18px 0;font-size:14px;line-height:1.65;color:${BRAND.text};">This link is valid for ${payload.expiryHours} hours and expires on ${escapeHtml(payload.expiresAt)}. It can only be used once.</p>
          ${warningBox('If you did not create this school, you can ignore this email. No account access is possible until the address is verified.')}
          <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:${BRAND.muted};">If the button does not work, copy this address into your browser:</p>
          <p style="margin:0 0 16px 0;font-size:12px;line-height:1.6;word-break:break-all;color:${BRAND.blue};">${escapeHtml(payload.verificationUrl)}</p>`,
        bodyText: `Verify your administrator email address:
${payload.verificationUrl}

This link is valid for ${payload.expiryHours} hours and expires on ${payload.expiresAt}. It can only be used once.

If you did not create ${payload.schoolName}, you can ignore this email.`,
      })
      return {
        subject: isResend
          ? `Your new ${PRODUCT_NAME} verification link`
          : `Welcome to ${PRODUCT_NAME} - verify your email`,
        ...result,
      }
    }

    case 'admin-verified': {
      const payload = data as EmailDataMap['admin-verified']
      const result = layout({
        preheader: `Your ${PRODUCT_NAME} email address is verified.`,
        heading: 'Your email address is verified',
        intro: `Hello ${payload.firstName}, your administrator account for ${payload.schoolName} is now fully active.`,
        bodyHtml: `${actionButton('Open your dashboard', payload.dashboardUrl)}
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.65;color:${BRAND.text};">You can now register classes and class teachers, review results and prepare report cards.</p>`,
        bodyText: `Your administrator account for ${payload.schoolName} is now fully active.

Open your dashboard: ${payload.dashboardUrl}`,
      })
      return { subject: `Your ${PRODUCT_NAME} email is verified`, ...result }
    }

    case 'teacher-credentials': {
      const payload = data as EmailDataMap['teacher-credentials']
      const result = layout({
        preheader: `Your ${PRODUCT_NAME} class teacher account for ${payload.schoolName}.`,
        heading: `You have been registered as a class teacher`,
        intro: `${payload.schoolName} has created a ${PRODUCT_NAME} account for you. You are the class teacher for ${payload.className}.`,
        bodyHtml: `${detailTable([
          ['School', payload.schoolName],
          ['Class', payload.className],
          ['Login email', payload.loginEmail],
        ])}
          ${passwordPanel(payload.temporaryPassword)}
          ${actionButton('Sign in to WiseGrade', payload.loginUrl)}
          ${warningBox('After signing in you must replace this temporary password with a personal password before you can open the class workspace. Never share your password with anyone.')}`,
        bodyText: `You have been registered as a class teacher.

School: ${payload.schoolName}
Class: ${payload.className}
Login email: ${payload.loginEmail}
Temporary password: ${payload.temporaryPassword}

Sign in: ${payload.loginUrl}

After signing in you must replace this temporary password with a personal password before you can open the class workspace. Never share your password with anyone.`,
      })
      return {
        subject: `Your ${PRODUCT_NAME} class teacher account for ${payload.schoolName}`,
        ...result,
      }
    }

    case 'teacher-first-login': {
      const payload = data as EmailDataMap['teacher-first-login']
      const result = layout({
        preheader: `Set a personal password for your ${PRODUCT_NAME} account.`,
        heading: 'Set your personal password',
        intro: `Hello ${payload.firstName}, your ${PRODUCT_NAME} account for ${payload.schoolName} still uses its temporary password.`,
        bodyHtml: `${actionButton('Set a new password', payload.changePasswordUrl)}
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.65;color:${BRAND.text};">Sign in with ${escapeHtml(payload.loginEmail)} and choose a password only you know. You cannot enter scores or manage your class until this step is complete.</p>`,
        bodyText: `Hello ${payload.firstName}, your ${PRODUCT_NAME} account for ${payload.schoolName} still uses its temporary password.

Set a new password: ${payload.changePasswordUrl}
Sign in with: ${payload.loginEmail}

You cannot enter scores or manage your class until this step is complete.`,
      })
      return { subject: `Set your personal ${PRODUCT_NAME} password`, ...result }
    }

    case 'subject-assignment':
    case 'subject-code-replaced': {
      const payload = data as EmailDataMap['subject-assignment']
      const replaced = template === 'subject-code-replaced'
      const result = layout({
        preheader: `Your ${PRODUCT_NAME} access code for ${payload.subjectName}.`,
        heading: replaced
          ? `A replacement access code for ${payload.subjectName}`
          : `You have been assigned ${payload.subjectName}`,
        intro: replaced
          ? `Your previous access code for ${payload.className} at ${payload.schoolName} has been replaced. Only the code below is valid now.`
          : `You have been assigned a subject at ${payload.schoolName}.`,
        bodyHtml: `${subjectDetails(payload)}
          ${codePanel(payload.accessCode)}
          ${actionButton('Open subject workspace', payload.accessCodeUrl)}
          ${warningBox('This code is reusable until it is replaced, revoked or expires. Do not forward it. If it expires, ask the class teacher for a replacement code.')}`,
        bodyText: `${replaced ? 'Your previous access code has been replaced.' : 'You have been assigned a subject.'}

${subjectText(payload)}

This code is reusable until it is replaced, revoked or expires. Do not forward it. If it expires, ask the class teacher for a replacement code.`,
      })
      return {
        subject: replaced
          ? `Your replacement ${PRODUCT_NAME} access code for ${payload.subjectName}`
          : `Your ${PRODUCT_NAME} access code for ${payload.subjectName}`,
        ...result,
      }
    }

    case 'subject-code-expired': {
      const payload = data as EmailDataMap['subject-code-expired']
      const result = layout({
        preheader: `Your ${PRODUCT_NAME} access code has expired.`,
        heading: 'Your access code has expired',
        intro: `The access code for ${payload.subjectName} (${payload.className}) at ${payload.schoolName} expired on ${payload.expiredAt}.`,
        bodyHtml: `<p style="margin:0 0 18px 0;font-size:14px;line-height:1.65;color:${BRAND.text};">Ask the class teacher responsible for ${escapeHtml(payload.className)} to generate a replacement code. Only an authorized class teacher for that class can issue one.</p>
          ${actionButton('Enter a replacement code', payload.accessCodeUrl)}`,
        bodyText: `The access code for ${payload.subjectName} (${payload.className}) at ${payload.schoolName} expired on ${payload.expiredAt}.

Ask the class teacher responsible for ${payload.className} to generate a replacement code. Only an authorized class teacher for that class can issue one.

Enter a replacement code: ${payload.accessCodeUrl}`,
      })
      return { subject: `Your ${PRODUCT_NAME} access code has expired`, ...result }
    }

    case 'smtp-test': {
      const payload = data as EmailDataMap['smtp-test']
      const result = layout({
        preheader: `${PRODUCT_NAME} SMTP test message.`,
        heading: 'SMTP test message',
        intro: `Hello ${payload.recipientName}, this message confirms that ${PRODUCT_NAME} can authenticate with the configured SMTP relay and submit a message for delivery.`,
        bodyHtml: detailTable([
          ['Sent at', payload.sentAt],
          ['SMTP host', payload.smtpHost],
        ]) + warningBox('Delivery to the recipient inbox depends on the mail provider and cannot be confirmed by this API. Check the recipient inbox before announcing that email is live.'),
        bodyText: `Hello ${payload.recipientName}, this message confirms that ${PRODUCT_NAME} can authenticate with the configured SMTP relay and submit a message for delivery.

Sent at: ${payload.sentAt}
SMTP host: ${payload.smtpHost}

Delivery to the recipient inbox depends on the mail provider and cannot be confirmed by this API.`,
      })
      return { subject: `${PRODUCT_NAME} SMTP test message`, ...result }
    }

    default: {
      const exhaustive: never = template
      throw new Error(`Unknown email template: ${String(exhaustive)}`)
    }
  }
}

/** Formats an instant for display in every email, independent of server locale. */
export function formatEmailDateTime(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value) + ' UTC'
}
