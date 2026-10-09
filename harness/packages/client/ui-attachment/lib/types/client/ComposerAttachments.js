import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AttachmentRail } from "../AttachmentRail.js";
import { DropOverlay } from "../DropOverlay.js";
import { ImageLightbox } from "../ImageLightbox.js";
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from "./labels.js";
import css from './ComposerAttachments.module.css';
/** Draft-image rail, document drop target, and original-image preview slot entry. */
export function ComposerAttachments({ attachments, canAcceptDrop, onAddImages, onRemoveImage, dropLimits, t, }) {
    const [preview, setPreview] = useState(null);
    const [dragActive, setDragActive] = useState(false);
    const dragDepth = useRef(0);
    const closePreview = useCallback(() => { setPreview(null); }, []);
    useEffect(() => {
        if (preview !== null && !attachments.some(attachment => attachment.id === preview.id))
            setPreview(null);
    }, [attachments, preview]);
    useEffect(() => {
        const fileTransfer = (event) => {
            const dataTransfer = event.dataTransfer;
            if (dataTransfer === null || !dataTransfer.types.includes('Files'))
                return null;
            return dataTransfer;
        };
        const reset = () => {
            dragDepth.current = 0;
            setDragActive(false);
        };
        const onDragEnter = (event) => {
            if (fileTransfer(event) === null)
                return;
            event.preventDefault();
            dragDepth.current += 1;
            setDragActive(true);
        };
        const onDragOver = (event) => {
            const dataTransfer = fileTransfer(event);
            if (dataTransfer === null)
                return;
            event.preventDefault();
            dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none';
        };
        const onDragLeave = (event) => {
            if (fileTransfer(event) === null)
                return;
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0)
                setDragActive(false);
            const leftViewport = event.clientX <= 0 || event.clientY <= 0
                || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
            if ((event.target === document.documentElement || event.target === document.body) && leftViewport)
                reset();
        };
        const onDrop = (event) => {
            const dataTransfer = fileTransfer(event);
            if (dataTransfer === null)
                return;
            event.preventDefault();
            reset();
            if (canAcceptDrop)
                onAddImages([...dataTransfer.files]);
        };
        document.addEventListener('dragenter', onDragEnter);
        document.addEventListener('dragover', onDragOver);
        document.addEventListener('dragleave', onDragLeave);
        document.addEventListener('drop', onDrop);
        window.addEventListener('dragend', reset);
        return () => {
            document.removeEventListener('dragenter', onDragEnter);
            document.removeEventListener('dragover', onDragOver);
            document.removeEventListener('dragleave', onDragLeave);
            document.removeEventListener('drop', onDrop);
            window.removeEventListener('dragend', reset);
        };
    }, [canAcceptDrop, onAddImages]);
    const railItems = useMemo(() => attachments.map(attachment => ({
        id: attachment.id,
        previewUrl: attachment.previewUrl,
        alt: attachment.file.name || t('image.pending'),
        removeLabel: t('image.remove', { name: attachment.file.name }),
        attachment,
    })), [attachments, t]);
    return (_jsxs(_Fragment, { children: [dragActive && (_jsx(DropOverlay, { disabled: !canAcceptDrop, labels: dropOverlayLabels(t, canAcceptDrop, dropLimits) })), railItems.length > 0 && (_jsx("div", { className: css.rail, children: _jsx(AttachmentRail, { items: railItems, labels: attachmentRailLabels(t), onOpen: (item) => { setPreview(item.attachment); }, onRemove: (item) => { onRemoveImage(item.attachment.id); } }) })), preview !== null && (_jsx(ImageLightbox, { src: preview.previewUrl, alt: preview.file.name || t('image.original'), labels: lightboxLabels(t), onClose: closePreview }))] }));
}
