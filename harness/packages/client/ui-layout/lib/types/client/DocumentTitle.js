import { useEffect } from 'react';
/**
 * Project the selected durable session title into the browser title and
 * restore the build-selected product title when unmounted.
 * @param props - Selected session title projection.
 * @returns No rendered content.
 */
export function DocumentTitle({ title, productTitle }) {
    useEffect(() => {
        document.title = title === undefined ? productTitle : `${title} — ${productTitle}`;
        return () => { document.title = productTitle; };
    }, [productTitle, title]);
    return null;
}
