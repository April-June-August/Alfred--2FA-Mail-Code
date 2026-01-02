#!/usr/bin/osascript -l JavaScript

// Utility function to strip HTML tags
function stripHtmlTags(html) {
    return html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Utility function to get context around the 2FA code
function getCodeContext(text, code) {
    if (!text || !code) return "";

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

    const contextWords = words.slice(startIndex, endIndex);
    let contextText = contextWords.join(" ");

    // Truncate if too long
    if (contextText.length > maxChars) {
        contextText = contextText.substring(0, maxChars - 1);
        // Find last complete word
        const lastSpace = contextText.lastIndexOf(" ");
        if (lastSpace > 0) {
            contextText = contextText.substring(0, lastSpace);
        }
    }

    // Add ellipsis if text was cut
    let result = contextText;
    if (startIndex > 0) {
        result = `…${result}`;
    }
    if (
        endIndex < words.length ||
        contextText.length < contextWords.join(" ").length
    ) {
        result = `${result}…`;
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
        "",
    );

    // Match numbers with 6 to 8 digits, not part of currency amounts
    const regex = /\b(?<![.,]\d|€|\$|£)(\d{6,8})(?!\d|[.,]\d|€|\$|£)\b/g;

    // Collect all matches
    const matches = [];
    let match = regex.exec(cleanedMsg);
    while (match !== null) {
        const code = match[0];
        // Only include codes that pass validation
        if (isValidCode(code)) {
            matches.push(code);
        }
        match = regex.exec(cleanedMsg);
    }

    // Sort by length in descending order (longer codes first)
    matches.sort((a, b) => b.length - a.length);

    // Return the first (longest) match, or null if no matches found
    return matches.length > 0 ? matches[0] : null;
}

// Helper function to process messages from a mailbox
function processMessages(messages, maxCount = 5) {
    const items = [];
    const processedMessages = new Set(); // To avoid duplicates

    // Sort messages by dateReceived (newest first) before slicing
    const sortedMessages = messages.sort((a, b) => {
        try {
            const dateA = a.dateReceived();
            const dateB = b.dateReceived();
            return dateB - dateA; // Newest first
        } catch {
            return 0; // Keep original order if can't get dates
        }
    });

    const messagesToProcess = sortedMessages.slice(0, maxCount);

    for (const message of messagesToProcess) {
        try {
            const messageId = message.id();

            // Skip if already processed
            if (processedMessages.has(messageId)) {
                continue;
            }
            processedMessages.add(messageId);

            const subject = message.subject() || "No Subject";
            const content = message.content();
            const htmlContent = content ? content.toString() : "";

            // Extract 2FA code
            const captchaCode = extractCaptchaFromContent(htmlContent);

            if (captchaCode) {
                const cleanText = stripHtmlTags(htmlContent);
                items.push({
                    title: `${subject}, Code: ${captchaCode}`,
                    subtitle: getCodeContext(cleanText, captchaCode),
                    arg: captchaCode,
                    variables: {
                        messageId: messageId.toString(),
                    },
                });
            }
        } catch (error) {
            // Skip messages that can't be processed
            const subject = message.subject() || "No Subject";
            console.log(
                `Skipping message - Subject: ${subject}, Error: ${error.message}`,
            );
        }
    }

    return items;
}

// Main function to get 2FA codes from mail
function getMail2FACodes() {
    // Access the Mail application
    const Mail = Application("Mail");
    Mail.includeStandardAdditions = true;

    // Get the mailboxes
    const junkMailbox = Mail.junkMailbox;
    const inboxMailbox = Mail.inbox;

    // Retrieve messages from each mailbox (if available)
    const junkMessages = junkMailbox ? junkMailbox.messages() : [];
    const inboxMessages = inboxMailbox ? inboxMailbox.messages() : [];

    console.log(`Reading ${inboxMessages.length} messages from inbox`);
    console.log(`Reading ${junkMessages.length} messages from junk mailbox`);

    // Process messages and extract 2FA codes
    let items = [];

    // Process messages from both mailboxes
    items = items.concat(processMessages(inboxMessages, 5));
    items = items.concat(processMessages(junkMessages, 5));

    let result = { items: items };

    // If no codes found, add a fallback item and set rerun
    if (items.length === 0) {
        result = {
            rerun: 2.0,
            items: [
                {
                    title: "No 2FA codes found",
                    subtitle: "No emails with valid 6+ digit codes detected",
                    arg: "",
                    valid: false,
                },
            ],
        };
    }

    return result;
}

function _run() {
    const result = getMail2FACodes();
    return JSON.stringify(result);
}
