import { GoogleGenAI, Type } from '@google/genai';
import { readCache, writeCache, getUncachedItems } from './cache.js';
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
    
    console.log(`Enriching ${uncachedArticles.length} new articles...`);
    
    const prompt = `
        Please analyze the following articles and provide structured enrichment data for each.
        You must return a JSON array containing an object for each article provided, matching the provided schema.
        
        Articles:
        ${JSON.stringify(uncachedArticles, null, 2)}
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: responseSchema,
                temperature: 0.1,
            }
        });
        
        const enrichedData = JSON.parse(response.text);
        
        await writeCache(enrichedData);
        
        const cache = await readCache();
        const requestedIds = new Set(articlesArray.map(a => a.id));
        return cache.filter(a => requestedIds.has(a.id));
    } catch (error) {
        console.error("Error during enrichment:", error);
        throw error;
    }
}
