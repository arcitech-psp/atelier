import { ChooserDirectoryFlow } from "./chooser-flow.js";
/** Locale namespace owning the browser dialog's copy. */
const LOCALE_NS = 'directory-browser';
/** Required services (cordis fiber inject): the slot registry, workspace UI service, and locale. */
export const inject = ['slots', 'uiWorkspace', 'locale'];
/**
 * Client plugin body: register the dialog's dictionaries and the browse flow
 * into both directory-flow holes through `slots.inject()` because the
 * ui-workspace entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => {
        // The two dictionaries land as a unit: if the second registration hits a
        // rival owner of the namespace, the first rolls back before the throw —
        // a failed activation must not squat the namespace's other locale.
        const disposers = [];
        const dictionaries = [
            ['zh', {
                    'browser.title': '选择工作区目录',
                    'browser.home': '主目录',
                    'browser.newFolder': '新建文件夹',
                    'browser.folderName': '文件夹名称',
                    'browser.createIn': '在"{name}"中新建文件夹',
                    'browser.untitledFolder': '未命名文件夹',
                    'browser.create': '创建',
                    'browser.cancel': '取消',
                    'browser.open': '打开',
                    'browser.editPath': '编辑路径',
                    'browser.loading': '加载中…',
                    'browser.truncated': '文件夹过多，仅显示开头部分。',
                    'browser.showHidden': '显示隐藏文件',
                    'chooser.title': '选择工作区文件夹',
                    'chooser.pathLabel': '文件夹路径',
                    'chooser.pathPlaceholder': '输入或粘贴文件夹路径…',
                    'chooser.recent': '最近使用',
                    'chooser.pinned': '已固定',
                    'chooser.empty': '还没有最近使用的工作区。请在上方输入路径，或使用快捷入口。',
                    'chooser.desktop': '桌面',
                    'chooser.documents': '文档',
                    'chooser.onedrive': 'OneDrive',
                    'chooser.newFolder': '新建文件夹…',
                    'chooser.folderName': '文件夹名称',
                    'chooser.create': '创建',
                    'chooser.cancel': '取消',
                    'chooser.open': '打开',
                    'chooser.native': '用 Windows 浏览…',
                    'chooser.up': '上一级文件夹',
                    'chooser.pin': '固定',
                    'chooser.unpin': '取消固定',
                    'chooser.clear': '清除',
                    'chooser.noMatch': '没有匹配的文件夹。',
                    'chooser.loading': '加载中…',
                    'chooser.truncated': '文件夹过多，仅显示开头部分。',
                    'chooser.time.now': '刚刚',
                    'chooser.time.minutes': '{n} 分钟前',
                    'chooser.time.hours': '{n} 小时前',
                    'chooser.time.days': '{n} 天前',
                    'chooser.time.months': '{n} 个月前',
                    'chooser.time.years': '{n} 年前',
                }],
            ['en', {
                    'browser.title': 'Select Workspace Directory',
                    'browser.home': 'Home',
                    'browser.newFolder': 'New folder',
                    'browser.folderName': 'Folder name',
                    'browser.createIn': 'New folder in "{name}"',
                    'browser.untitledFolder': 'Untitled folder',
                    'browser.create': 'Create',
                    'browser.cancel': 'Cancel',
                    'browser.open': 'Open',
                    'browser.editPath': 'Edit path',
                    'browser.loading': 'Loading…',
                    'browser.truncated': 'Too many folders to list; only the beginning is shown.',
                    'browser.showHidden': 'Show hidden files',
                    'chooser.title': 'Choose a workspace folder',
                    'chooser.pathLabel': 'Folder path',
                    'chooser.pathPlaceholder': 'Type or paste a folder path…',
                    'chooser.recent': 'Recent',
                    'chooser.pinned': 'Pinned',
                    'chooser.empty': 'No recent workspaces yet. Type a path above or use a shortcut.',
                    'chooser.desktop': 'Desktop',
                    'chooser.documents': 'Documents',
                    'chooser.onedrive': 'OneDrive',
                    'chooser.newFolder': 'New folder…',
                    'chooser.folderName': 'Folder name',
                    'chooser.create': 'Create',
                    'chooser.cancel': 'Cancel',
                    'chooser.open': 'Open',
                    'chooser.native': 'Browse with Windows…',
                    'chooser.up': 'Parent folder',
                    'chooser.pin': 'Pin',
                    'chooser.unpin': 'Unpin',
                    'chooser.clear': 'Clear',
                    'chooser.noMatch': 'No matching folders.',
                    'chooser.loading': 'Loading…',
                    'chooser.truncated': 'Too many folders to list; only the beginning is shown.',
                    'chooser.time.now': 'just now',
                    'chooser.time.minutes': '{n} min ago',
                    'chooser.time.hours': '{n} h ago',
                    'chooser.time.days': '{n} d ago',
                    'chooser.time.months': '{n} mo ago',
                    'chooser.time.years': '{n} y ago',
                }],
        ];
        try {
            for (const [locale, dict] of dictionaries)
                disposers.push(ctx.locale.register(LOCALE_NS, locale, dict));
        }
        catch (error) {
            for (const dispose of disposers.reverse())
                dispose();
            throw error;
        }
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'directory-picker-browse: dialog dictionaries');
    const injected = () => {
        // The registry source feeds the Recent list; it is optional (only local picks list without it).
        let workspaces;
        try {
            const registry = ctx.get('workspaces');
            workspaces = registry?.list;
        }
        catch {
            workspaces = undefined;
        }
        return {
            listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
            createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
            pickNative: () => ctx.uiWorkspace.pickDirectory(),
            workspaces,
            t: ctx.locale.bind(LOCALE_NS),
        };
    };
    // Both declaration lifetimes must be live before the pair installs; the
    // generator makes the two registrations one transactional effect. The
    // outer/inner nesting order is arbitrary; neither hole has precedence.
    ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
        yield ctx.slots.register({
            name: 'conversation.hero.workspace.directoryFlow', inject: injected,
        }, ChooserDirectoryFlow);
        yield ctx.slots.register({
            name: 'sidebar.workspaces.directoryFlow', inject: injected,
        }, ChooserDirectoryFlow);
    }));
}
