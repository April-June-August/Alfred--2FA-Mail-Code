#!/usr/bin/osascript -l JavaScript

// Configuration
const DEBUG = false; // Set to true to enable verbose logging

// Debug logging helper
function log(msg) {
    if (DEBUG) console.log(msg);
}

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
// Now also stores account/mailbox info for each message
function filterRecentMessages(messages, minutesBack = 15, accountName = '', mailboxName = '') {
    const cutoffDate = new Date();
    cutoffDate.setMinutes(cutoffDate.getMinutes() - minutesBack);

    const recentMessages = [];

    // Check first 50 messages per inbox (since we now check multiple inboxes)
    const maxToCheck = Math.min(messages.length, 50);

    // Debug: log first message date for this account
    if (maxToCheck > 0 && accountName) {
        try {
            const firstMsg = messages[0];
            const firstDate = firstMsg.dateReceived();
            const isRecent = firstDate >= cutoffDate;
            log(`  ${accountName}: first msg date ${firstDate}, recent=${isRecent}`);
        } catch (e) {
            log(`  ${accountName}: error reading first msg: ${e.message}`);
        }
    }

    for (let i = 0; i < maxToCheck; i++) {
        try {
            const message = messages[i];
            const dateReceived = message.dateReceived();

            if (dateReceived >= cutoffDate) {
                // Store message with account info as a wrapper object
                recentMessages.push({
                    message: message,
                    accountName: accountName,
                    mailboxName: mailboxName
                });
            }
        } catch (error) {
            // Skip messages with errors
            if (accountName) log(`  ${accountName}: error at msg ${i}: ${error.message}`);
            continue;
        }
    }

    if (accountName) log(`  ${accountName}: found ${recentMessages.length} recent messages`);
    return recentMessages;
}

// Helper function to group messages by sender/account
function groupMessagesBySender(messageWrappers) {
    const groups = new Map();

    for (const wrapper of messageWrappers) {
        try {
            const sender = wrapper.message.sender() || 'Unknown';

            if (!groups.has(sender)) {
                groups.set(sender, []);
            }
            groups.get(sender).push(wrapper);
        } catch (error) {
            continue;
        }
    }

    return groups;
}

// Helper function to process messages from a mailbox
// accountName and mailboxName are passed through for tracking
function processMessages(messages, maxCount = 5, maxPerAccount = 2, accountName = '', mailboxName = '') {
    const items = [];
    const processedMessages = new Set(); // To avoid duplicates

    // First, filter to only recent messages (last 15 minutes)
    const recentMessages = filterRecentMessages(messages, 15, accountName, mailboxName);

    if (recentMessages.length > 0) {
        console.log(`  ${accountName || 'Mailbox'}: ${recentMessages.length} recent messages, extracting codes...`);
    }

    // Group by sender to ensure we get variety
    const messageGroups = groupMessagesBySender(recentMessages);

    // Sort messages by dateReceived (newest first)
    const sortedMessages = recentMessages.sort((a, b) => {
        try {
            const dateA = a.message.dateReceived();
            const dateB = b.message.dateReceived();
            return dateB - dateA; // Newest first
        } catch (error) {
            return 0; // Keep original order if can't get dates
        }
    });

    // Track codes per account to ensure diversity
    const codesPerAccount = new Map();

    for (const wrapper of sortedMessages) {
        // Stop if we have enough total items
        if (items.length >= maxCount) {
            break;
        }

        try {
            const message = wrapper.message;
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

            log(`    Processing: ${subject} (content: ${htmlContent.length} chars)`);

            // Extract 2FA code
            const captchaCode = extractCaptchaFromContent(htmlContent);
            log(`    Extracted code: ${captchaCode || 'none'}`);

            if (captchaCode) {
                const cleanText = stripHtmlTags(htmlContent);
                // Get account/mailbox info from wrapper
                const msgAccountName = wrapper.accountName || accountName || '';
                const msgMailboxName = wrapper.mailboxName || mailboxName || '';

                items.push({
                    title: `${subject}, Code: ${captchaCode}`,
                    subtitle: getCodeContext(cleanText, captchaCode),
                    arg: captchaCode,
                    variables: {
                        messageId: messageId.toString(),
                        accountName: msgAccountName,
                        mailboxName: msgMailboxName
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

    // Get all accounts and check each one's inbox individually
    // This ensures we find recent emails regardless of which account they're in
    const accounts = Mail.accounts();
    console.log(`Checking ${accounts.length} email accounts...`);

    let items = [];
    const maxTotalItems = 5;
    const maxPerSender = 2;

    // Check each account's INBOX
    for (let i = 0; i < accounts.length; i++) {
        if (items.length >= maxTotalItems) break;

        try {
            const account = accounts[i];
            const accountName = account.name();
            log(`Checking account: ${accountName}`);
            const mailboxes = account.mailboxes();

            // Find the INBOX mailbox for this account
            for (let j = 0; j < mailboxes.length; j++) {
                const mailbox = mailboxes[j];
                const mailboxName = mailbox.name();

                if (mailboxName === 'INBOX' || mailboxName.toLowerCase() === 'inbox') {
                    const messages = mailbox.messages();

                    // Process this account's inbox
                    const remaining = maxTotalItems - items.length;
                    const accountItems = processMessages(messages, remaining, maxPerSender, accountName, mailboxName);
                    items = items.concat(accountItems);

                    break; // Found INBOX, move to next account
                }
            }
        } catch (error) {
            console.log(`Error checking account: ${error.message}`);
            continue;
        }
    }

    // Also check junk mail if we still have room
    if (items.length < maxTotalItems) {
        try {
            const junkMailbox = Mail.junkMailbox;
            if (junkMailbox) {
                const junkMessages = junkMailbox.messages();
                const remaining = maxTotalItems - items.length;
                const junkItems = processMessages(junkMessages, remaining, maxPerSender, 'Junk', 'Junk');
                items = items.concat(junkItems);
            }
        } catch (error) {
            console.log(`Error checking junk: ${error.message}`);
        }
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