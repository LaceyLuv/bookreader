import { TITLE_BAR_HEIGHT } from '../lib/appChrome'
import gyeolIcon from '../assets/brand/gyeol-icon.png'

export default function TitleBar({ visible = true }) {
    if (!visible) return null

    return (
        <div
            className="fixed left-0 right-0 top-0 z-[1000] flex items-center justify-between px-2"
            style={{
                height: `${TITLE_BAR_HEIGHT}px`,
                backgroundColor: 'var(--panel-bg)',
                color: 'var(--app-fg)',
                borderBottom: '1px solid var(--panel-border)',
            }}
        >
            <div className="flex h-full flex-1 select-none items-center gap-2 px-2 text-xs opacity-80">
                <img src={gyeolIcon} alt="" aria-hidden="true" className="h-4 w-4 rounded-[4px]" />
                <span>글결</span>
            </div>
        </div>
    )
}
