/**
 * Tibetan tokenizer
 * Splits Tibetan text into syllables
 */

/**
 * Split Tibetan text into syllables
 * 
 * @param {string} text - the Tibetan text to split
 * @returns {string[]} array of syllables
 */ 
function splitSyllables(text) {
    // Normalize whitespace (newlines, tabs, etc.) to single spaces and trim
    const cleanedText = text.replace(/\s+/g, ' ').trim();
    
    const tibetanCharRegex = /[\u0F40-\u0FBC]+/g;
    const blocks = cleanedText.match(tibetanCharRegex) || [];
    const result = [];
    
    for (let block of blocks) {
        // Split on the particles འམ / འང: they can appear mid-block (e.g. བདེའམམིའང),
        // not only at the end, so split the whole block instead of peeling from the tail.
        // The capturing group keeps འམ / འང as their own segments.
        const parts = block.split(/(འམ|འང)/);
        for (const part of parts) {
            if (part) result.push(part);
        }
    }
    
    return result;
}

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = {
        splitSyllables
    };
} else {
    // Browser
    window.TibetanTokenizer = {
        splitSyllables
    };
}