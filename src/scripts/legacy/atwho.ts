/**
 * At-who setup for legacy @mentions.
 *
 * @author Adam Charron <adam.c@vanillaforums.com>
 * @copyright 2009-2018 Vanilla Forums Inc.
 * @license GPLv2
 */

import { formatUrl, getMeta } from "@core/application";
import { log } from "@core/utility";

// Store cache results in an outer scoped variable., so all instances share the same data
// and can build the cache together.
const atCache = {};
const atEmpty = {};

// The current raw match. This is needed to properly match quoted strings.
let rawMatch: string | undefined;

// Set minimum characters to type for @mentions to fire
const minCharacters = getMeta('mentionMinChars', 2);

// Max suggestions to show in dropdown.
const maxSuggestions = getMeta('mentionSuggestionCount', 5);

// Server response limit. This should match the limit set in
// *UserController->TagSearch* and UserModel->TagSearch
const serverLimit = 30;

// Emoji, set in definition list in foot, by Emoji class. Make sure
// that class is getting instantiated, otherwise emoji will be empty.

interface IEmojiData {
    assetPath?: string;
    emoji?: {
        [key: string]: string;
    };
    format?: string;
}

const emojiData: IEmojiData = getMeta('emoji', {});
const emojis = emojiData.emoji || {};
const emojiFormat = emojiData.format || '';
const emojiAssetPath = emojiData.assetPath || '';

const emojiList = Object.entries(emojis).map(([index, emojiImageUrl]) => {
    const parts = emojiImageUrl.split('.');

    return {'name': index, 'filename': emojiImageUrl, 'basename': parts[0], 'ext': '.' + parts[1]};
});

const emojiContentTemplate = emojiFormat
    .replace(/{(.+?)}/g, '$${$1}')
    .replace('%1$s', '${src}')
    .replace('%2$s', '${name}')
    .replace('${src}', emojiAssetPath + '/${filename}')
    .replace('${dir}', emojiAssetPath);
const emojiTemplate = '<li data-value=":${name}:" class="at-suggest-emoji"><span class="emoji-wrap">' + emojiContentTemplate + '</span> <span class="emoji-name">${name}</span></li>';

/**
 * Custom matching to allow quotation marks in the matching string as well as spaces.
 * Spaces make things more complicated.
 *
 * @param flag - The character sequence used to trigger this match (e.g. :).
 * @param subtext - The string to be tested.
 * @param shouldStartWithSpace - Should the pattern include a test for a whitespace prefix?
 * @returns Matching string if successful.  Null on failure to match.
 */
export function matchAtMention(flag: string, subtext: string, shouldStartWithSpace: boolean): string|null {
    // Split the string at the lines to allow for a simpler regex.
    const lines = subtext.split("\n");
    const lastLine = lines[lines.length - 1];

    // If you change this you MUST change the regex in src/scripts/__tests__/legacy.test.js !!!
    /**
     * Put together the non-excluded characters.
     *
     * @param {boolean} excludeWhiteSpace - Whether or not to exclude whitespace characters.
     *
     * @returns {string} A Regex string.
     */
    function nonExcludedCharacters(excludeWhiteSpace) {
        let excluded = '[^' +
            '"' + // Quote character
            '\\u0000-\\u001f\\u007f-\\u009f' + // Control characters
            '\\u2028';// Line terminator

        if (excludeWhiteSpace) {
            excluded += '\\s';
        }

        excluded += "]";
        return excluded;
    }

    let regexStr =
        '@' + // @ Symbol triggers the match
        '(' +
        // One or more non-greedy characters that aren't excluded. White is allowed, but a starting quote is required.
        '"(' + nonExcludedCharacters(false) + '+?)"?' +

        '|' + // Or
        // One or more non-greedy characters that aren't exluded. Whitespace is excluded.
        '(' + nonExcludedCharacters(true) + '+?)"?' +

        ')' +
        '(?:\\n|$)'; // Newline terminates.

    // Determined by at.who library
    if (shouldStartWithSpace) {
        regexStr = '(?:^|\\s)' + regexStr;
    }
    const regex = new RegExp(regexStr, 'gi');
    const match = regex.exec(lastLine);
    if (match) {
        rawMatch = match[0];

        // Return either of the matching groups (quoted or unquoted).
        return match[2] ||  match[1];
    } else {

        // No match
        return null;
    }
}

/**
 * Custom matching for our emoji images. Eg. :) :/ >:(
 *
 * @param flag - The character sequence used to trigger this match (e.g. :).
 * @param subtext - The string to be tested.
 * @param shouldStartWithSpace - Should the pattern include a test for a whitespace prefix?
 * @returns Matching string if successful.  Null on failure to match.
 */
export function matchFakeEmoji(flag, subtext, shouldStartWithSpace) {
    flag = flag.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
    if (shouldStartWithSpace) {
        flag = '(?:^|\\s)' + flag;
    }

    // Some browsers append a linefeed to the end of subtext.  We need to allow for it.
    const regexp = new RegExp(flag + '([A-Za-z0-9_\+\-]*|[^\\x00-\\xff]*)(?:\\n)?$', 'gi');
    const match = regexp.exec(subtext);

    if (match) {
        return match[2] || match[1];
    } else {
        return null;
    }
}

export function initializeAtComplete(editorElement, iframe?: HTMLIFrameElement) {

    // Handle iframe situation
    const iframeWindow = iframe ? iframe.contentWindow : '';

    function remoteDataHandler(query, callback) {
        // Do this because of undefined when adding spaces to
        // matcher callback, as it will be monitoring changes.
        query = query || '';

        // Only all query strings greater than min_characters
        if (query.length >= minCharacters) {

            // If the cache array contains less than LIMIT 30
            // (according to server logic), then there's no
            // point sending another request to server, as there
            // won't be any more results, as this is the maximum.
            let shouldContinueFiltering = true;

            // Remove last character so that the string can be
            // found in the cache, if exists, then check if its
            // matching array has less than the server limit of
            // matches, which means there are no more, so save the
            // additional server request from being sent.
            let filterString = '';

            // Loop through string and find first closest match in
            // the cache, and if a match, check if more filtering
            // is required.
            for (let i = 0, l = query.length; i < l; i++) {
                filterString = query.slice(0, -i);

                if (atCache[filterString]
                    && atCache[filterString].length < serverLimit) {

                    // Add this other query to empty array, so that it
                    // will not fire off another request.
                    atEmpty[query] = query;

                    // Do not filter more, meaning, do not send
                    // another server request, as all the necessary
                    // data is already in memory.
                    shouldContinueFiltering = false;
                    break;
                }
            }

            // Check if query would be empty, based on previously
            // cached empty results. Compare against the start of
            // the latest query string.
            let isQueryEmpty = false;

            // Loop through cache of empty query strings.
            for (const key in atEmpty) {
                if (atEmpty.hasOwnProperty(key)) {
                    // See if cached empty results match the start
                    // of the latest query. If so, then no point
                    // sending new request, as it will return empty.
                    if (query.match(new RegExp('^' + key + '+')) !== null) {
                        isQueryEmpty = true;
                        break;
                    }
                }
            }

            function filterSuccessHandler(data) {
                if (Array.isArray(data)) {
                    data.forEach((result) => {
                        if (typeof result === "object" && typeof result.name === "string") {
                            // Convert special characters to safely insert into template.
                            result.name = result.name.replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/"/g, "&quot;")
                                .replace(/'/g, "&apos;");
                        }
                    });
                }

                callback(data);

                // If data is empty, cache the results to prevent
                // other requests against similarly-started
                // query strings.
                if (data.length) {
                    atCache[query] = data;
                } else {
                    atEmpty[query] = query;
                }
            }

            // Produce the suggestions based on data either
            // cached or retrieved.
            if (shouldContinueFiltering && !isQueryEmpty && !atCache[query]) {
                $.getJSON(formatUrl('/user/tagsearch'), {
                    "q": query,
                    "limit": serverLimit
                }, filterSuccessHandler);
            } else {
                // If no point filtering more as the parent filter
                // has not been maxed out with responses, use the
                // closest parent filter instead of the latest
                // query string.
                if (!shouldContinueFiltering) {
                    callback(atCache[filterString]);
                } else {
                    callback(atCache[query]);
                }
            }
        }
    }

    /**
     * Pre-insert handler for atwho.
     *
     * Note, in contenteditable mode (iframe for us), the value is surrounded by span tags.
     */
    function beforeInsertHandler(value: string, $li: JQuery<any>): string {
        // It's better to use the value provided, as it may have
        // html tags around it, depending on mode. Using the
        // regular expression avoids the need to check what mode
        // the suggestion is made in, and then constructing
        // it based on that. Optional assignment for undefined
        // matcher callback results.
        let username = $li.data('value') || '';
        // Pop off the flag--usually @ or :
        username = username.slice(1, username.length);

        // Check if there are any whitespaces, and if so, add
        // quotation marks around the whole name.
        const requiresQuotation = /[^\w-]/.test(username);

        // Check if there are already quotation marks around
        // the string--double or single.
        const hasQuotation = /(["'])(.+)(["'])/g.test(username);

        let insert = username;
        if (requiresQuotation && !hasQuotation) {
            // Do not even need to have value wrapped in
            // any tags at all. It will be done automatically.
            // insert = value.replace(/(.*\>?)@([\w\d\s\-\+\_]+)(\<?.*)/, '$1@"$2"$3');
            insert = '"' + username + '"';
        }

        // This is needed for checking quotation mark directly
        // after at character, and preventing another at character
        // from being inserted into the page.
        const raw_at_match = rawMatch || '';

        const atQuote = /.?@(["'])/.test(raw_at_match);

        // If atQuote is false, then insert the at character,
        // otherwise it means the user typed a quotation mark
        // directly after the at character, which, would get
        // inserted again if not checked. atQuote would
        // be false most of the time; the exception is when
        // it's true.
        if (!atQuote) {
            insert = this.at + insert;
        }

        // The last character prevents the matcher from trigger on nearly everything.
        return insert;
    }

    /**
     * Custom highlighting to accept spaces in names.
     * This is almost a copy of the default in the library, with tweaks in the regex.
     */
    function highlightHandler(li: string, query: string): string {
        if (!query) {
            return li;
        }
        const regexp = new RegExp(">\\s*(\\w*)(" + query.replace("+", "\\+") + ")(\\w*)\\s*(\\s+.+)?<", 'ig');
        // Capture group 4 for possible spaces
        return li.replace(regexp, (str, $1, $2, $3, $4) => {
            // Weird Chrome behaviour, so check for undefined, then
            // set to empty string if so.
            if (typeof $3 === 'undefined') {
                $3 = '';
            }
            if (typeof $4 === 'undefined') {
                $4 = '';
            }

            return '> ' + $1 + '<strong>' + $2 + '</strong>' + $3 + $4 + ' <';
        });
    }

    $(editorElement)
        .atwho({
            at: '@',
            tpl: '<li data-value="@${name}" data-id="${id}">${name}</li>',
            limit: maxSuggestions,
            callbacks: {
                remote_filter: remoteDataHandler,
                before_insert: beforeInsertHandler,
                highlighter: highlightHandler,
                matcher: matchAtMention,
            },
            cWindow: iframeWindow
        })
        .atwho({
            at: ':',
            tpl: emojiTemplate,
            insert_tpl: "${atwho-data-value}",
            callbacks: {
                matcher: matchFakeEmoji,
                tplEval: (tpl, map) => log(map),
            },
            limit: maxSuggestions,
            data: emojiList,
            cWindow: iframeWindow
        });

    /**
     * This hook is triggered when atWho places a selection list in the window.
     * The context is passed implicitly when triggered by at.js.
     *
     * @param event - A custom event triggered by the advanced editor iframe/wysiwyg.
     * @param offset - The pixel offsets inside of the iframe.
     * @param context - Context from the contenteditable inside of the iframe.
     */
    function iframeAtWhoRepositionHandler(event: any, offset: any, context: any){

        // Actual suggestion box that will appear.
        const suggestionElement = context.view.$el;

        // The area where text will be typed (contenteditable body).
        const $inputor = context.$inputor;

        // Display it below the text.
        const lineHeight = parseInt($inputor.css('line-height'), 10);

        // offset contains the top left values of the offset to the iframe
        // we need to convert that to main window coordinates
        const iframeOffset = $(iframe).offset();
        let leftCoordinate = (iframeOffset ? iframeOffset.left : 0) + offset.left;
        let topCoordinate =  iframeOffset ? iframeOffset.top : 0;
        let selectHeight = 0;

        // In wysiwyg mode, the suggestbox follows the typing, which
        // does not happen in regular mode, so adjust it.
        // Either @ or : for now.
        const at = context.at;
        const { text } = context.query;
        const fontMirror = $('.BodyBox,.js-bodybox');
        const font = fontMirror.css('font-size') + ' ' + fontMirror.css('font-family');

        // Get font width
        const fontWidth = (at + text).width(font) - 2;

        if (at === '@') {
            leftCoordinate -= fontWidth;
        }

        if (at === ':') {
            leftCoordinate -= 2;
        }

        // atWho adds 3 select areas, presumably for differnet positing on screen (above below etc)
        // This finds the active one and gets the container height
        $(suggestionElement).each((index, element) => {
            const outerHeight = $(element).outerHeight();
            const height = $(element).height();

            if (outerHeight && height && outerHeight > 0) {
                selectHeight += height + lineHeight;
            }
        });

        // Now should we show the selection box above or below?
        const windowHeight = $(window).height() || 0;
        const scrollPosition = $(window).scrollTop() || 0;
        const selectionPosition = topCoordinate + offset.top - ($(window).scrollTop() || 0);
        const iAvailableSpace = windowHeight - (selectionPosition - scrollPosition);

        if (iAvailableSpace >= selectHeight) {
            // Enough space below
            topCoordinate = topCoordinate + offset.top + selectHeight - scrollPosition;
        }
        else {
            // Place it above instead
            // @todo should check if this is more space than below
            topCoordinate = topCoordinate + offset.top - scrollPosition;
        }

        // Move the select box
        const newOffset = {
            left: leftCoordinate,
            top: topCoordinate
        };
        $(suggestionElement).offset(newOffset);
    }


    // Only necessary for iframe.
    // Based on work here: https://github.com/ichord/At.js/issues/124
    if (iframeWindow) {
        $(iframeWindow).on("reposition.atwho", iframeAtWhoRepositionHandler);
    }
}