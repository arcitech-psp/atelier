import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageLightbox } from "./ImageLightbox.js";
import css from './MessageImage.module.css';
/** Display box for a lone image (DeepSeek Chat rule): long edge 240px with
 * the rendered aspect ratio clamped to [0.25, 4] — the overflow is cropped by
 * `object-fit: cover` — and never upscaled past the image's natural size. The
 * crop anchor keeps the top of very tall images and the left of very wide
 * ones, where the informative content usually starts. */
function singleFit(dimensions) {
    const natural = dimensions.width / dimensions.height;
    const ratio = Math.min(4, Math.max(0.25, natural));
    const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 };
    const scale = Math.min(1, dimensions.width / box.width, dimensions.height / box.height);
    return {
        width: Math.max(1, Math.round(box.width * scale)),
        height: Math.max(1, Math.round(box.height * scale)),
        objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
    };
}
/** Intrinsic dimensions of one gallery entry; a preview's stay unknown until its intake probe resolved. */
function dimensionsOf(image) {
    if ('attachment' in image)
        return image.attachment;
    return image.preview.width !== undefined && image.preview.height !== undefined
        ? { width: image.preview.width, height: image.preview.height }
        : undefined;
}
/**
 * Compact history renderer with retryable loading and click-to-open original
 * preview. A lone image renders at its `singleFit` size; an image among
 * several renders as a fixed 64px square tile. The preview arm displays its
 * local URL directly — no loader round-trip, no failure/retry surface.
 *
 * @param props.image - the durable reference to load, or the local preview to display.
 * @param props.load - session-authorized URL loader for the durable arm.
 * @param props.variant - `single` for a message's lone image, `tile` otherwise.
 * @param props.labels - resolved strings (tooltip, loading, retry, lightbox).
 * @returns the bounded thumbnail button, or the retry control on failure.
 */
export function MessageImage({ image, load, variant, labels }) {
    const preview = 'preview' in image ? image.preview : undefined;
    const attachment = 'attachment' in image ? image.attachment : undefined;
    const [loaded, setLoaded] = useState(() => attachment === undefined ? null : (load.peek?.(attachment) ?? null));
    const [error, setError] = useState(false);
    const [open, setOpen] = useState(false);
    // Retry re-arms the one load effect below, so every attempt — first load or
    // retry — runs under the same liveness guard and the same reset.
    const [attempt, setAttempt] = useState(0);
    const request = useCallback(() => { setAttempt(a => a + 1); }, []);
    const close = useCallback(() => { setOpen(false); }, []);
    const dimensions = useMemo(() => dimensionsOf(image), [image]);
    const fit = useMemo(() => {
        if (variant === 'tile')
            return undefined;
        if (variant === 'view' && dimensions !== undefined) {
            const width = Math.min(720, dimensions.width);
            return { width, height: width * dimensions.height / dimensions.width, objectPosition: 'center' };
        }
        // A preview whose intake probe has not resolved sizes as a square crop;
        // the durable replacement restores the exact fit.
        return dimensions === undefined
            ? { width: 240, height: 240, objectPosition: 'center' }
            : singleFit(dimensions);
    }, [dimensions, variant]);
    useEffect(() => {
        if (attachment === undefined)
            return;
        let live = true;
        setError(false);
        setLoaded(load.peek?.(attachment) ?? null);
        void load(attachment).then((url) => { if (live)
            setLoaded(url); }).catch(() => { if (live)
            setError(true); });
        return () => { live = false; };
    }, [attachment, load, attempt]);
    const src = preview?.url ?? loaded;
    const label = (preview?.name ?? attachment?.name) ?? labels.image;
    if (error)
        return _jsx("button", { type: "button", className: css.error, "data-variant": variant, onClick: request, children: labels.loadFailed });
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: css.frame, "data-variant": variant, style: fit === undefined ? undefined : { width: fit.width, height: fit.height, aspectRatio: `${fit.width} / ${fit.height}` }, title: labels.open, "aria-label": labels.openNamed(label), onClick: () => { if (src !== null)
                    setOpen(true); }, children: src === null
                    ? _jsx("span", { className: css.loading, children: labels.loading })
                    : _jsx("img", { src: src, alt: label, style: fit === undefined ? undefined : { objectPosition: fit.objectPosition } }) }), open && src !== null && _jsx(ImageLightbox, { src: src, alt: label, labels: labels.lightbox, onClose: close })] }));
}
/** Wrapping image group shared by user and assistant history: a lone image
 * renders large, several render as 64px square tiles (DeepSeek Chat rule). */
export function ImageGallery({ images, load, align, labels }) {
    if (images.length === 0)
        return null;
    const variant = align === 'start' ? 'view' : images.length === 1 ? 'single' : 'tile';
    return (_jsx("div", { className: css.gallery, "data-align": align, children: images.map((image, index) => (_jsx(MessageImage, { image: image, load: load, variant: variant, labels: labels }, `${'attachment' in image ? image.attachment.attachmentId : image.preview.url}:${index}`))) }));
}
