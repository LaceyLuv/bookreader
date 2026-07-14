export function createBookmarkThemeStyle(themeStyle = {}) {
    const text = themeStyle.text || '#4b382d'
    const card = themeStyle.card || '#fffaf1'
    const warmCard = `color-mix(in srgb, ${card} 90%, #fff0d2 10%)`

    return {
        ...themeStyle,
        card: warmCard,
        accent: `color-mix(in srgb, ${text} 72%, #8a5a2f 28%)`,
        selected: `color-mix(in srgb, ${warmCard} 78%, #e6b66d 22%)`,
        item: `color-mix(in srgb, ${warmCard} 94%, ${text} 6%)`,
        input: `color-mix(in srgb, ${warmCard} 96%, white 4%)`,
        editor: `color-mix(in srgb, ${warmCard} 92%, ${text} 8%)`,
    }
}
