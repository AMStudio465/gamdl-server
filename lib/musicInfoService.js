const AppleMusicApi = require('./appleMusicApi');
const {
    VALID_URL_PATTERN,
    SONG_MEDIA_TYPE,
    ALBUM_MEDIA_TYPE,
    MUSIC_VIDEO_MEDIA_TYPE,
    ARTIST_MEDIA_TYPE,
    UPLOADED_VIDEO_MEDIA_TYPE,
    PLAYLIST_MEDIA_TYPE,
} = require('./constants');

class MusicInfoService {
    constructor() {
        this.apiCache = new Map();
    }

    parseUrl(url) {
        const match = url.match(VALID_URL_PATTERN);
        if (!match) {
            return null;
        }

        const groups = match.groups;
        return {
            storefront: groups.storefront || groups.library_storefront || 'us',
            type: groups.type || groups.library_type,
            id: groups.id || groups.library_id,
            subId: groups.sub_id,
            isLibrary: !!groups.library_id,
        };
    }

    async getOrCreateApi(storefront) {
        const key = storefront.toLowerCase();
        if (!this.apiCache.has(key)) {
            const api = new AppleMusicApi(storefront);
            await api.setup();
            this.apiCache.set(key, api);
        }
        return this.apiCache.get(key);
    }

    async getMusicInfo(url) {
        const urlInfo = this.parseUrl(url);
        if (!urlInfo) {
            return {
                success: false,
                error: 'Invalid Apple Music URL',
            };
        }

        try {
            const api = await this.getOrCreateApi(urlInfo.storefront);
            
            // If URL has a sub_id, it's a song in an album
            const mediaType = urlInfo.subId ? 'song' : urlInfo.type;
            const mediaId = urlInfo.subId || urlInfo.id;
            const isLibrary = urlInfo.isLibrary;

            let result = null;
            let mediaTypeLabel = '';

            if (SONG_MEDIA_TYPE.has(mediaType)) {
                result = await api.getSong(mediaId);
                mediaTypeLabel = 'song';
            } else if (ALBUM_MEDIA_TYPE.has(mediaType)) {
                if (isLibrary) {
                    result = await api.getLibraryAlbum(mediaId);
                } else {
                    result = await api.getAlbum(mediaId);
                }
                mediaTypeLabel = 'album';
            } else if (PLAYLIST_MEDIA_TYPE.has(mediaType)) {
                if (isLibrary) {
                    result = await api.getLibraryPlaylist(mediaId);
                } else {
                    result = await api.getPlaylist(mediaId);
                }
                mediaTypeLabel = 'playlist';
            } else if (ARTIST_MEDIA_TYPE.has(mediaType)) {
                result = await api.getArtist(mediaId);
                mediaTypeLabel = 'artist';
            } else if (MUSIC_VIDEO_MEDIA_TYPE.has(mediaType)) {
                result = await api.getMusicVideo(mediaId);
                mediaTypeLabel = 'music-video';
            } else if (UPLOADED_VIDEO_MEDIA_TYPE.has(mediaType)) {
                result = await api.getUploadedVideo(mediaId);
                mediaTypeLabel = 'uploaded-video';
            }

            if (!result) {
                return {
                    success: false,
                    error: `${mediaTypeLabel} not found`,
                };
            }

            return {
                success: true,
                data: this.formatResponse(result, mediaTypeLabel, urlInfo),
            };
        } catch (error) {
            console.error('Error fetching music info:', error);
            return {
                success: false,
                error: error.message || 'Failed to fetch music information',
            };
        }
    }

    formatResponse(apiResponse, mediaType, urlInfo) {
        const data = apiResponse.data[0];
        const attributes = data.attributes;

        const baseInfo = {
            type: mediaType,
            id: data.id,
            url: urlInfo,
            name: attributes.name,
        };

        // Common fields
        if (attributes.artwork) {
            baseInfo.artwork = this.formatArtwork(attributes.artwork);
        }

        if (attributes.url) {
            baseInfo.externalUrl = attributes.url;
        }

        // Type-specific fields
        switch (mediaType) {
            case 'song':
                return {
                    ...baseInfo,
                    artistName: attributes.artistName,
                    albumName: attributes.albumName,
                    releaseDate: attributes.releaseDate,
                    durationInMillis: attributes.durationInMillis,
                    genreNames: attributes.genreNames,
                    isrc: attributes.isrc,
                    trackNumber: attributes.trackNumber,
                    discNumber: attributes.discNumber,
                    hasLyrics: attributes.hasLyrics,
                    contentRating: attributes.contentRating,
                    composerName: attributes.composerName,
                };

            case 'album':
                return {
                    ...baseInfo,
                    artistName: attributes.artistName,
                    releaseDate: attributes.releaseDate,
                    trackCount: attributes.trackCount,
                    genreNames: attributes.genreNames,
                    copyright: attributes.copyright,
                    recordLabel: attributes.recordLabel,
                    upc: attributes.upc,
                    contentRating: attributes.contentRating,
                    isSingle: attributes.isSingle,
                    isCompilation: attributes.isCompilation,
                    tracks: this.extractTracks(data),
                };

            case 'playlist':
                return {
                    ...baseInfo,
                    curatorName: attributes.curatorName,
                    description: attributes.description?.standard,
                    lastModifiedDate: attributes.lastModifiedDate,
                    trackCount: data.relationships?.tracks?.data?.length || 0,
                    tracks: this.extractTracks(data),
                };

            case 'artist':
                return {
                    ...baseInfo,
                    genreNames: attributes.genreNames,
                    editorialNotes: attributes.editorialNotes,
                    albums: this.extractRelationshipData(data, 'albums'),
                    musicVideos: this.extractRelationshipData(data, 'music-videos'),
                };

            case 'music-video':
                return {
                    ...baseInfo,
                    artistName: attributes.artistName,
                    releaseDate: attributes.releaseDate,
                    durationInMillis: attributes.durationInMillis,
                    genreNames: attributes.genreNames,
                    isrc: attributes.isrc,
                    contentRating: attributes.contentRating,
                };

            case 'uploaded-video':
                return {
                    ...baseInfo,
                    artistName: attributes.artistName,
                    durationInMillis: attributes.durationInMillis,
                };

            default:
                return baseInfo;
        }
    }

    formatArtwork(artwork) {
        return {
            url: artwork.url,
            width: artwork.width,
            height: artwork.height,
            bgColor: artwork.bgColor,
            textColor1: artwork.textColor1,
            textColor2: artwork.textColor2,
            textColor3: artwork.textColor3,
            textColor4: artwork.textColor4,
        };
    }

    extractTracks(data) {
        if (!data.relationships || !data.relationships.tracks || !data.relationships.tracks.data) {
            return [];
        }

        return data.relationships.tracks.data.map(track => {
            const attrs = track.attributes;
            if (!attrs) return null;

            return {
                id: track.id,
                type: track.type,
                name: attrs.name,
                artistName: attrs.artistName,
                albumName: attrs.albumName,
                durationInMillis: attrs.durationInMillis,
                trackNumber: attrs.trackNumber,
                discNumber: attrs.discNumber,
                hasLyrics: attrs.hasLyrics,
            };
        }).filter(Boolean);
    }

    extractRelationshipData(data, relationshipType) {
        if (!data.relationships || !data.relationships[relationshipType] || !data.relationships[relationshipType].data) {
            return [];
        }

        return data.relationships[relationshipType].data.map(item => {
            const attrs = item.attributes;
            if (!attrs) return null;

            return {
                id: item.id,
                type: item.type,
                name: attrs.name,
                artistName: attrs.artistName,
                releaseDate: attrs.releaseDate,
                trackCount: attrs.trackCount,
            };
        }).filter(Boolean);
    }
}

module.exports = MusicInfoService;
