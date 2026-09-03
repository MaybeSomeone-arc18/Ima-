import { GoogleGenAI, Type } from '@google/genai';
import { readCache, writeCache, getUncachedItems } from './cache.js';
import { extractFullText } from './ingestion.js';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.warn("Warning: GEMINI_API_KEY is not set in environment variables.");
}

const ai = new GoogleGenAI({ apiKey: apiKey });

const responseSchema = {
    type: Type.ARRAY,
    description: "List of enriched articles",
    items: {
        type: Type.OBJECT,
        properties: {
            id: {
                type: Type.STRING,
                description: "The unique identifier of the article"
            },
            tldr: {
                type: Type.STRING,
                description: "A short summary of the article, max 20 words"
            },
            whyItMatters: {
                type: Type.ARRAY,
                items: {
                    type: Type.STRING
                },
                description: "2-3 strings explaining why this article matters"
            },
            category: {
                type: Type.STRING,
                enum: ["AI", "Security", "Hardware", "Startups/Funding", "Policy", "DevTools", "General"],
                description: "The category of the article"
            },
            importanceScore: {
                type: Type.INTEGER,
                description: "Importance score from 0 to 100"
            },
            clusterTag: {
                type: Type.STRING,
                description: "A short tag for clustering related articles, or null if none",
                nullable: true
            }
        },
        required: ["id", "tldr", "whyItMatters", "category", "importanceScore"]
    }
};

export async function enrichBatchWithGemini(articlesArray) {
    if (!articlesArray || articlesArray.length === 0) return [];
    
    const uncachedArticles = await getUncachedItems(articlesArray);
    if (uncachedArticles.length === 0) {
        console.log("All articles are already cached.");
        const cache = await readCache();
        const requestedIds = new Set(articlesArray.map(a => a.id));
        return cache.filter(a => requestedIds.has(a.id));
    }
    const MAX_BATCH_SIZE = 3;
    const batchToProcess = uncachedArticles.slice(0, MAX_BATCH_SIZE);
    
    console.log(`Enriching ${batchToProcess.length} new articles (out of ${uncachedArticles.length} uncached)...`);
    
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let enrichedData = [];

    for (const article of batchToProcess) {
        // Asynchronously fetch full HTML only when it's about to be processed
        if (article.text.length < 250) {
            console.log(`Extracting full text for ${article.id}...`);
            const extractedText = await extractFullText(article.url);
            if (extractedText) {
                article.text = extractedText;
            }
        }

        const prompt = `
            Please analyze the following article and provide structured enrichment data.
            You must return a JSON array containing an object for the article provided, strictly matching the provided schema.
            Example JSON Output: [{ "id": "...", "tldr": "...", "whyItMatters": ["..."], "category": "AI", "importanceScore": 85, "clusterTag": "..." }]
            
            Article:
            ${JSON.stringify(article, null, 2)}
        `;

        try {
            console.log(`Sending API request for article ID: ${article.id}...`);
            const response = await ai.models.generateContent({
                model: 'gemini-3.6-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: responseSchema,
                    temperature: 0.1,
                }
            });
            
            try {
                const parsedArray = JSON.parse(response.text);
                
                // Merge the AI data with the original raw article data so the cache has titles/URLs
                const fullEnrichedData = parsedArray.map(parsedItem => {
                    return { ...article, ...parsedItem };
                });
                
                enrichedData = enrichedData.concat(fullEnrichedData);
                // Save incrementally
                await writeCache(fullEnrichedData);
            } catch (parseError) {
                console.error("Failed to parse JSON from Gemini for article:", article.id);
            }
        } catch (error) {
            console.error(`Error during API call for article ${article.id}:`, error.message);
        }
        
        // Anti-rate-limit sleep (2 seconds)
        await sleep(2000);
    }
    
    // Always return a complete list for the requested articles: 
    // Data from cache, or on-the-fly fallback data for uncached items
    const cache = await readCache();
    const cachedIds = new Set(cache.map(c => c.id));
    
    const finalData = articlesArray.map(article => {
        if (cachedIds.has(article.id)) {
            return cache.find(c => c.id === article.id);
        } else {
            // Generate on-the-fly fallback for UI (NOT cached, so it retries next cycle)
            return {
                id: article.id,
                tldr: "Summary temporarily unavailable.",
                whyItMatters: ["Enrichment pending or failed."],
                category: "General",
                importanceScore: 50,
                clusterTag: null
            };
        }
    });
    
    return finalData;
}
