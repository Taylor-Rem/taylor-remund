import { resume } from './resume.ts';
import { site } from './site.ts';

const ORIGIN = 'https://taylorremund.com';

/**
 * The Person structured data (REWRITE.md § F1: on `/` and on `/resume/`), as
 * raw JSON-LD that is safe inside a script element. Read by search engines,
 * never shown. It holds only what `/resume/` itself states: his name, the
 * photograph, GitHub and LinkedIn, the current role and employer (the first
 * role of the experience list), and the place the about paragraph names.
 */
export function personJsonLd(): string {
  const { about, experience, contact, person } = resume;
  const current = experience.roles[0]!;
  const sameAs = contact.links.filter((l) => /^https:\/\//.test(l.href)).map((l) => l.href);
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: site.strip.name.text,
    url: `${ORIGIN}/`,
    image: `${ORIGIN}${about.photo.src}`,
    sameAs,
    jobTitle: current.title.text,
    worksFor: { '@type': 'Organization', name: current.employer.text },
    address: { '@type': 'PostalAddress', addressLocality: person.locality.text, addressRegion: person.region.text },
  }).replace(/</g, '\\u003c');
}
