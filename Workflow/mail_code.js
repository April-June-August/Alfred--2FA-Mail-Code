#!/usr/bin/osascript -l JavaScript

function run(argv) {
    // Access the Mail application
    const Mail = Application('Mail');
    Mail.includeStandardAdditions = true;

    // Get the mailboxes
    const junkMailbox = Mail.junkMailbox;
    const inboxMailbox = Mail.inbox;
    
    // Retrieve messages from each mailbox (if available)
    const junkMessages = junkMailbox ? junkMailbox.messages() : [];
    const inboxMessages = inboxMailbox ? inboxMailbox.messages() : [];

    // Return empty result if both mailboxes are empty
    if (junkMessages.length === 0 && inboxMessages.length === 0) {
        return JSON.stringify({ items: [] });
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

    // Extract 2FA code from message content (ported from Messages workflow)
    function extractCaptchaFromContent(content) {
        // Remove HTML tags first
        const cleanedContent = stripHtmlTags(content);
        
        // Remove date strings in various formats
        const cleanedMsg = cleanedContent.replace(
            /\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g,
            ''
        );

        // Match numbers with 3 to 7 digits, not part of currency amounts
        const regex = /\b(?<![.,]\d|€|\$|£)(\d{3,7})(?!\d|[.,]\d|€|\$|£)\b/g;

        // Collect all matches
        const matches = [];
        let match;
        while ((match = regex.exec(cleanedMsg)) !== null) {
            matches.push(match[0]);
        }

        // Sort by length in descending order (longer codes first)
        matches.sort((a, b) => b.length - a.length);

        // Return the first (longest) match, or null if no matches found
        return matches.length > 0 ? matches[0] : null;
    }

    // Process messages and extract 2FA codes
    const items = [];
    const processedMessages = new Set(); // To avoid duplicates

    // Helper function to process messages from a mailbox
    function processMessages(messages, maxCount = 5) {
        const messagesToProcess = messages.slice(0, maxCount);
        
        for (const message of messagesToProcess) {
            try {
                const messageId = message.id();
                
                // Skip if already processed
                if (processedMessages.has(messageId)) {
                    continue;
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
                        uid: messageId,
                        variables: {
                            messageId: messageId.toString()
                        }
                    });
                }
            } catch (error) {
                // Skip messages that can't be processed
                continue;
            }
        }
    }

    // Process messages from both mailboxes
    processMessages(inboxMessages, 5);
    processMessages(junkMessages, 5);

    // Sort items by title (most recent subjects tend to be processed first)
    items.sort((a, b) => a.title.localeCompare(b.title));

    // Return Alfred script filter JSON format
    return JSON.stringify({ items: items });
}