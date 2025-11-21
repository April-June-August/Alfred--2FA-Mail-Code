#!/usr/bin/osascript -l JavaScript

// Utility function to strip HTML tags
function stripHtmlTags(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Utility function to get context around the 2FA code
function getCodeContext(text, code) {
    if (!text || !code) return '';
    
    // Find the position of the code in the text
    const codeIndex = text.indexOf(code);
    if (codeIndex === -1) return code;
    
    // Split text into words
    const words = text.split(/\s+/);
    
    // Find which word contains the code
    let codeWordIndex = -1;
    let currentPos = 0;
    
    for (let i = 0; i < words.length; i++) {
        const wordStart = currentPos;
        const wordEnd = currentPos + words[i].length;
        
        if (codeIndex >= wordStart && codeIndex < wordEnd) {
            codeWordIndex = i;
            break;
        }
        
        currentPos = wordEnd + 1; // +1 for space
    }
    
    if (codeWordIndex === -1) return code;
    
    // Extract context words (max 10 words total, max 80 chars)
    const maxWords = 10;
    const maxChars = 80;
    
    // Calculate how many words to take before and after
    let beforeWords = Math.floor((maxWords - 1) / 2);
    let afterWords = Math.floor((maxWords - 1) / 2);
    
    // Adjust if we're near the beginning or end
    const availableBefore = codeWordIndex;
    const availableAfter = words.length - codeWordIndex - 1;
    
    if (availableBefore < beforeWords) {
        afterWords += beforeWords - availableBefore;
        beforeWords = availableBefore;
    }
    
    if (availableAfter < afterWords) {
        beforeWords += afterWords - availableAfter;
        afterWords = availableAfter;
    }
    
    // Extract the context words
    const startIndex = Math.max(0, codeWordIndex - beforeWords);
    const endIndex = Math.min(words.length, codeWordIndex + afterWords + 1);
    
    let contextWords = words.slice(startIndex, endIndex);
    let contextText = contextWords.join(' ');
    
    // Truncate if too long
    if (contextText.length > maxChars) {
        contextText = contextText.substring(0, maxChars - 1);
        // Find last complete word
        const lastSpace = contextText.lastIndexOf(' ');
        if (lastSpace > 0) {
            contextText = contextText.substring(0, lastSpace);
        }
    }
    
    // Add ellipsis if text was cut
    let result = contextText;
    if (startIndex > 0) {
        result = '…' + result;
    }
    if (endIndex < words.length || contextText.length < contextWords.join(' ').length) {
        result = result + '…';
    }
    
    return result;
}

// Check if a code has valid patterns (not repeating digits)
function isValidCode(code) {
    // Check for 4+ consecutive identical digits (0000, 1111, etc.)
    if (/(\d)\1{3,}/.test(code)) {
        return false;
    }
    
    return true;
}

// Extract 2FA code from message content
function extractCaptchaFromContent(content) {
    // Remove HTML tags first
    const cleanedContent = stripHtmlTags(content);

    // Remove date strings in various formats
    const cleanedMsg = cleanedContent.replace(
        /\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g,
        ''
    );

    // Collect all matches from different patterns
    const matches = [];

    // Pattern 1: Numeric codes (6 to 8 digits)
    const numericRegex = /\b(?<![.,]\d|€|\$|£)(\d{6,8})(?!\d|[.,]\d|€|\$|£)\b/g;
    let match;
    while ((match = numericRegex.exec(cleanedMsg)) !== null) {
        const code = match[0];
        if (isValidCode(code)) {
            matches.push({ code: code, type: 'numeric', length: code.length });
        }
    }

    // Pattern 2: Alphanumeric codes (6 to 8 characters, must contain both letters and numbers)
    const alphanumericRegex = /\b(?=.*[A-Z])(?=.*\d)[A-Z0-9]{6,8}\b/gi;
    while ((match = alphanumericRegex.exec(cleanedMsg)) !== null) {
        const code = match[0].toUpperCase();
        // Ensure it has both letters and numbers (no pure letter codes)
        if (/[A-Z]/.test(code) && /\d/.test(code)) {
            matches.push({ code: code, type: 'alphanumeric', length: code.length });
        }
    }

    // Pattern 3: Dash-separated codes (e.g., H8Z-EDJ, VQC-TO3, AB12-CD34)
    const dashSeparatedRegex = /\b[A-Z0-9]{2,4}-[A-Z0-9]{2,4}\b/gi;
    while ((match = dashSeparatedRegex.exec(cleanedMsg)) !== null) {
        const code = match[0].toUpperCase();
        // Ensure it has both letters and numbers across the whole code
        if (/[A-Z]/.test(code) && /\d/.test(code)) {
            // Filter out obvious marketing codes (like "14-DAY", "30-OFF")
            // Check both the original code and without dash
            const removeDash = code.replace(/-/g, '');
            const isMarketingPattern = /^(\d{1,3})[-]?(DAY|OFF|DEAL|SAVE|GET)$/i.test(code) ||
                                      /^(SAVE|GET|BUY)[-]?(\d{1,3})$/i.test(code) ||
                                      /^(\d{1,3})(DAY|OFF|DEAL|SAVE|GET)$/i.test(removeDash);

            if (!isMarketingPattern) {
                // Calculate length without the dash for comparison
                const lengthWithoutDash = removeDash.length;
                matches.push({ code: code, type: 'dash-separated', length: lengthWithoutDash });
            }
        }
    }

    // Sort by type preference (numeric first) then by length (longer first)
    matches.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'numeric' ? -1 : 1; // Prefer numeric
        }
        return b.length - a.length; // Longer codes first
    });

    // Return the first (best) match, or null if no matches found
    return matches.length > 0 ? matches[0].code : null;
}

// Helper function to filter messages by date (only recent ones)
function filterRecentMessages(messages, minutesBack = 15) {
    const cutoffDate = new Date();
    cutoffDate.setMinutes(cutoffDate.getMinutes() - minutesBack);

    const recentMessages = [];

    // Only process enough messages to find recent ones (limit to first 100 to avoid full scan)
    const maxToCheck = Math.min(messages.length, 100);

    for (let i = 0; i < maxToCheck; i++) {
        try {
            const message = messages[i];
            const dateReceived = message.dateReceived();

            if (dateReceived >= cutoffDate) {
                recentMessages.push(message);
            }
        } catch (error) {
            // Skip messages with errors
            continue;
        }
    }

    return recentMessages;
}

// Helper function to group messages by sender/account
function groupMessagesBySender(messages) {
    const groups = new Map();

    for (const message of messages) {
        try {
            const sender = message.sender() || 'Unknown';

            if (!groups.has(sender)) {
                groups.set(sender, []);
            }
            groups.get(sender).push(message);
        } catch (error) {
            continue;
        }
    }

    return groups;
}

// Helper function to process messages from a mailbox
function processMessages(messages, maxCount = 5, maxPerAccount = 2) {
    const items = [];
    const processedMessages = new Set(); // To avoid duplicates

    // First, filter to only recent messages (last 15 minutes)
    const recentMessages = filterRecentMessages(messages, 15);

    console.log(`Filtered to ${recentMessages.length} recent messages (last 15 min)`);

    // Group by sender to ensure we get variety
    const messageGroups = groupMessagesBySender(recentMessages);

    // Sort messages by dateReceived (newest first)
    const sortedMessages = recentMessages.sort((a, b) => {
        try {
            const dateA = a.dateReceived();
            const dateB = b.dateReceived();
            return dateB - dateA; // Newest first
        } catch (error) {
            return 0; // Keep original order if can't get dates
        }
    });

    // Track codes per account to ensure diversity
    const codesPerAccount = new Map();

    for (const message of sortedMessages) {
        // Stop if we have enough total items
        if (items.length >= maxCount) {
            break;
        }

        try {
            const messageId = message.id();

            // Skip if already processed
            if (processedMessages.has(messageId)) {
                continue;
            }

            const sender = message.sender() || 'Unknown';

            // Check if we've hit the per-account limit
            const accountCount = codesPerAccount.get(sender) || 0;
            if (accountCount >= maxPerAccount) {
                continue; // Skip to maintain diversity
            }

            processedMessages.add(messageId);

            const subject = message.subject() || 'No Subject';
            const content = message.content();
            const htmlContent = content ? content.toString() : '';

            // Extract 2FA code
            const captchaCode = extractCaptchaFromContent(htmlContent);

            if (captchaCode) {
                const cleanText = stripHtmlTags(htmlContent);
                items.push({
                    title: `${subject}, Code: ${captchaCode}`,
                    subtitle: getCodeContext(cleanText, captchaCode),
                    arg: captchaCode,
                    variables: {
                        messageId: messageId.toString()
                    }
                });

                // Increment count for this account
                codesPerAccount.set(sender, accountCount + 1);
            }
        } catch (error) {
            // Skip messages that can't be processed
            try {
                const subject = message.subject() || 'No Subject';
                console.log(`Skipping message - Subject: ${subject}, Error: ${error.message}`);
            } catch (e) {
                console.log(`Skipping message - Error: ${error.message}`);
            }
            continue;
        }
    }

    return items;
}

// Main function to get 2FA codes from mail
function getMail2FACodes() {
    // Access the Mail application
    const Mail = Application('Mail');
    Mail.includeStandardAdditions = true;

    const startTime = Date.now();

    // Get the mailboxes
    const junkMailbox = Mail.junkMailbox;
    const inboxMailbox = Mail.inbox;

    // Retrieve messages from each mailbox (if available)
    const junkMessages = junkMailbox ? junkMailbox.messages() : [];
    const inboxMessages = inboxMailbox ? inboxMailbox.messages() : [];

    console.log(`Total messages: ${inboxMessages.length} inbox, ${junkMessages.length} junk`);

    // Process messages and extract 2FA codes
    // Use maxCount=5 total, maxPerAccount=2 to ensure diversity
    let items = [];

    // Process inbox first (more likely to have valid 2FA codes)
    items = items.concat(processMessages(inboxMessages, 5, 2));

    // If we still have room, check junk (but only if inbox didn't fill us up)
    if (items.length < 5) {
        const remaining = 5 - items.length;
        items = items.concat(processMessages(junkMessages, remaining, 2));
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Processing completed in ${elapsedTime}s, found ${items.length} codes`);

    let result = { items: items };

    // If no codes found, add a fallback item and set rerun
    if (items.length === 0) {
        result = {
            rerun: 2.0,
            items: [{
                title: "No 2FA codes found",
                subtitle: "No emails with valid codes detected in last 15 minutes",
                arg: "",
                valid: false,
                icon: {
                    path: "warning.png"
                }
            }]
        };
    }

    return result;
}

function run(argv) {
    const result = getMail2FACodes();
    return JSON.stringify(result);
}