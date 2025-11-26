const axios = require('axios');
const {
    AMP_API_URL,
    APPLE_MUSIC_HOMEPAGE_URL,
} = require('./constants');

class AppleMusicApi {
    constructor(storefront = 'us', language = 'en-US') {
        this.storefront = storefront;
        this.language = language;
        this.token = null;
        this.client = null;
    }

    async setup() {
        await this._setupClient();
        await this._setupToken();
    }

    async _setupClient() {
        this.client = axios.create({
            headers: {
                'accept': '*/*',
                'accept-language': 'en-US',
                'origin': APPLE_MUSIC_HOMEPAGE_URL,
                'priority': 'u=1, i',
                'referer': APPLE_MUSIC_HOMEPAGE_URL,
                'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            },
            params: {
                l: this.language,
            },
            timeout: 60000,
        });
    }

    async _setupToken() {
        const response = await axios.get(APPLE_MUSIC_HOMEPAGE_URL);
        const homePage = response.data;

        const indexJsUriMatch = homePage.match(/\/(assets\/index-legacy[~-][^/"]+\.js)/);
        if (!indexJsUriMatch) {
            throw new Error('index.js URI not found in Apple Music homepage');
        }
        const indexJsUri = indexJsUriMatch[1];

        const indexJsResponse = await axios.get(`${APPLE_MUSIC_HOMEPAGE_URL}/${indexJsUri}`);
        const indexJsPage = indexJsResponse.data;

        const tokenMatch = indexJsPage.match(/(?=eyJh)(.*?)(?=")/);
        if (!tokenMatch) {
            throw new Error('Token not found in index.js page');
        }
        this.token = tokenMatch[1];

        this.client.defaults.headers.common['authorization'] = `Bearer ${this.token}`;
    }

    async getSong(songId, extend = 'extendedAssetUrls', include = 'lyrics,albums') {
        try {
            const response = await this.client.get(
                `${AMP_API_URL}/v1/catalog/${this.storefront}/songs/${songId}`,
                {
                    params: {
                        extend,
                        include,
                    },
                }
            );

            if (!response.data || !response.data.data) {
                throw new Error('Error getting song');
            }

            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getMusicVideo(musicVideoId, include = 'albums') {
        try {
            const response = await this.client.get(
                `${AMP_API_URL}/v1/catalog/${this.storefront}/music-videos/${musicVideoId}`,
                {
                    params: {
                        include,
                    },
                }
            );

            if (!response.data || !response.data.data) {
                throw new Error('Error getting music video');
            }

            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getUploadedVideo(postId) {
        try {
            const response = await this.client.get(
                `${AMP_API_URL}/v1/catalog/${this.storefront}/uploaded-videos/${postId}`
            );

            if (!response.data || !response.data.data) {
                throw new Error('Error getting uploaded video');
            }

            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getAlbum(albumId, extend = 'extendedAssetUrls') {
        try {
            const response = await this.client.get(
                `${AMP_API_URL}/v1/catalog/${this.storefront}/albums/${albumId}`,
                {
                    params: {
                        extend,
                    },
                }
            );

            if (!response.data || !response.data.data) {
                throw new Error('Error getting album');
            }

            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getPlaylist(playlistId, limitTracks = 300, extend = 'extendedAssetUrls') {
        try {
            const response = await this.client.get(
                `${AMP_API_URL}/v1/catalog/${this.storefront}/playlists/${playlistId}`,
                {
                    params: {
                        'limit[tracks]': limitTracks,
                        extend,
                    },
                }
            );

            if (!response.data || !response.data.data) {
                throw new Error('Error getting playlist');
            }

            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getArtist(artistId, include = 'albums,music-videos', limit = 100) {
        try {
            const params = {
                include,
            };
            
            // Add limit for each include type
            include.split(',').forEach(inc => {
                params[`limit[${inc}]`] = limit;
            });

            const response = await this.client.get(
                `${AMP_API_URL}/v1/catalog/${this.storefront}/artists/${artistId}`,
                { params }
            );

            if (!response.data || !response.data.data) {
                throw new Error('Error getting artist');
            }

            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getLibraryAlbum(albumId, extend = 'extendedAssetUrls') {
        try {
            const response = await this.client.get(
                `${AMP_API_URL}/v1/me/library/albums/${albumId}`,
                {
                    params: {
                        extend,
                    },
                }
            );

            if (!response.data || !response.data.data) {
                throw new Error('Error getting library album');
            }

            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getLibraryPlaylist(playlistId, include = 'tracks', limit = 100, extend = 'extendedAssetUrls') {
        try {
            const params = {
                include,
                extend,
            };
            
            include.split(',').forEach(inc => {
                params[`limit[${inc}]`] = limit;
            });

            const response = await this.client.get(
                `${AMP_API_URL}/v1/me/library/playlists/${playlistId}`,
                { params }
            );

            if (!response.data || !response.data.data) {
                throw new Error('Error getting library playlist');
            }

            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }
}

module.exports = AppleMusicApi;
