import siteJson from './site.json';
import { assertContent } from './schema.ts';

/** The site-wide text: strip, navigation, footer, section headings. Validated on load. */
export const site = assertContent(siteJson, 'src/content/site.json');
