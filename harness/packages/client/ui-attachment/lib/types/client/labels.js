/**
 * Resolve original-image lightbox strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated lightbox labels.
 */
export function lightboxLabels(t) {
    return { dialog: t('image.preview'), close: t('image.closePreview') };
}
/**
 * Resolve historical message-image strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated message-image labels.
 */
export function messageImageLabels(t) {
    return {
        image: t('image.label'),
        open: t('image.openOriginal'),
        openNamed: label => t('image.openOriginalLabel', { label }),
        loading: t('image.loading'),
        loadFailed: t('image.loadFailed'),
        lightbox: lightboxLabels(t),
    };
}
/**
 * Resolve the document-level drop invitation and its optional limits line.
 * @param t - conversation namespace translator.
 * @param accepting - whether the composer can accept dropped files.
 * @param limits - optional translated count and size values.
 * @returns translated drop-overlay labels.
 */
export function dropOverlayLabels(t, accepting, limits) {
    if (!accepting)
        return { title: t('image.dropBlocked') };
    return {
        title: t('image.dropTitle'),
        desc: limits === undefined ? undefined : t('image.dropDesc', limits),
    };
}
/**
 * Resolve draft-image rail strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated attachment-rail labels.
 */
export function attachmentRailLabels(t) {
    return {
        group: t('image.pending'),
        open: t('image.openOriginal'),
        scrollLeft: t('image.scrollLeft'),
        scrollRight: t('image.scrollRight'),
    };
}
