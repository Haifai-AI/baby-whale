import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { IconDownloadOutline16, IconEllipsisOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import { SessionLogDownloadDialog } from "./Dialog.js";
import css from './HeaderAction.module.css';
/**
 * Render the Session Header more-actions icon button, its download menu, and the shared result dialog.
 * @param props - Session runtime, download controller, and localized copy.
 * @returns the persistent Header action and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props) {
    const { sessionId, useSessionLogDownload, request, t } = props;
    const entry = useSessionLogDownload(state => state.bySession[String(sessionId)]);
    const busy = entry?.status === 'downloading';
    const [open, setOpen] = useState(false);
    return (_jsxs(_Fragment, { children: [_jsx(Menu, { open: open, align: "end", dense: true, onClose: () => { setOpen(false); }, items: [{ id: 'download', label: t('menu.download'), icon: _jsx(IconDownloadOutline16, {}), disabled: busy }], onSelect: () => {
                    setOpen(false);
                    void request(sessionId);
                }, anchor: (_jsx("button", { type: "button", className: css.moreButton, "aria-label": t('header.more'), "aria-haspopup": "menu", "aria-expanded": open, "aria-busy": busy, onClick: () => { setOpen(value => !value); }, children: _jsx(IconEllipsisOutline16, {}) })) }), _jsx(SessionLogDownloadDialog, { ...props })] }));
}
//# sourceMappingURL=HeaderAction.js.map