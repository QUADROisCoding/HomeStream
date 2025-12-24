// ============ STATE & CONFIG ============
let allContent = [];
let featuredContent = null;

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', () => {
    loadContent();
    setupNavbarScroll();
    setupSearch()
    setupModalClose();
});

// ============ CONTENT LOADING ============
async function loadContent() {
    try {
        const response = await fetch('/api/content');
        allContent = await response.json();

        if (allContent.length > 0) {
            // Set featured content (random or most recent)
            featuredContent = allContent[0];
            updateHero(featuredContent);
        }

        // Populate carousels
        populateCarousel('recentCarousel', allContent.slice(0, 10));
        populateCarousel('moviesCarousel', allContent.filter(c => c.type === 'movie'));
        populateCarousel('seriesCarousel', allContent.filter(c => c.type === 'series'));

        // Show/hide empty sections
        toggleSectionVisibility();
    } catch (error) {
        console.error('Error loading content:', error);
        showToast('Failed to load content', 'error');
    }
}

function updateHero(content) {
    const heroBackground = document.getElementById('heroBackground');
    const heroBadge = document.getElementById('heroBadge');
    const heroTitle = document.getElementById('heroTitle');
    const heroMeta = document.getElementById('heroMeta');
    const heroDescription = document.getElementById('heroDescription');
    const heroPlayBtn = document.getElementById('heroPlayBtn');
    const heroInfoBtn = document.getElementById('heroInfoBtn');

    if (content.thumbnail) {
        heroBackground.style.backgroundImage = `url('${content.thumbnail}')`;
    } else {
        heroBackground.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)';
    }

    heroBadge.textContent = content.type === 'movie' ? '🎬 Movie' : '📺 Series';
    heroTitle.textContent = content.title;

    const metaParts = [];
    if (content.year) metaParts.push(content.year);
    if (content.genre) metaParts.push(content.genre);
    heroMeta.innerHTML = metaParts.map(m => `<span>${m}</span>`).join('');

    heroDescription.textContent = content.description || 'No description available.';

    if (content.video_path) {
        heroPlayBtn.style.display = 'inline-flex';
        heroPlayBtn.onclick = () => openModal(content);
    }

    heroInfoBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
    More Info
  `;
    heroInfoBtn.href = '#';
    heroInfoBtn.onclick = (e) => {
        e.preventDefault();
        openModal(content);
    };
}

// ============ CAROUSEL ============
function populateCarousel(carouselId, items) {
    const carousel = document.getElementById(carouselId);

    if (items.length === 0) {
        carousel.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
        <h3 class="empty-title">No content yet</h3>
        <p class="empty-text">Upload your first video to get started!</p>
        <a href="/upload.html" class="btn btn-primary">Upload Now</a>
      </div>
    `;
        return;
    }

    carousel.innerHTML = items.map(item => createContentCard(item)).join('');
}

function createContentCard(item) {
    const thumbnail = item.thumbnail
        ? `<img src="${item.thumbnail}" alt="${item.title}" loading="lazy">`
        : `<div class="placeholder-thumbnail">🎬</div>`;

    return `
    <div class="content-card" onclick="openModal(${JSON.stringify(item).replace(/"/g, '&quot;')})">
      <div class="card-image">
        ${thumbnail}
        <div class="card-overlay">
          <button class="card-play-btn">▶</button>
        </div>
      </div>
      <h3 class="card-title">${escapeHtml(item.title)}</h3>
      <div class="card-meta">
        ${item.year ? `<span>${item.year}</span>` : ''}
        ${item.genre ? `<span class="card-badge">${item.genre}</span>` : ''}
      </div>
    </div>
  `;
}

function scrollCarousel(carouselId, direction) {
    const carousel = document.getElementById(carouselId);
    const scrollAmount = carousel.clientWidth * 0.8;
    carousel.scrollBy({
        left: scrollAmount * direction,
        behavior: 'smooth'
    });
}

function toggleSectionVisibility() {
    const movies = allContent.filter(c => c.type === 'movie');
    const series = allContent.filter(c => c.type === 'series');

    document.getElementById('moviesSection').style.display = movies.length === 0 && allContent.length > 0 ? 'none' : 'block';
    document.getElementById('seriesSection').style.display = series.length === 0 && allContent.length > 0 ? 'none' : 'block';
}

// ============ VIDEO MODAL ============
async function openModal(content) {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('videoPlayer');
    const title = document.getElementById('modalTitle');
    const meta = document.getElementById('modalMeta');
    const description = document.getElementById('modalDescription');
    const episodesSection = document.getElementById('episodesSection');
    const episodesList = document.getElementById('episodesList');

    // Set content info
    title.textContent = content.title;
    description.textContent = content.description || 'No description available.';

    const metaParts = [];
    if (content.year) metaParts.push(`<span>${content.year}</span>`);
    if (content.genre) metaParts.push(`<span>${content.genre}</span>`);
    if (content.type) metaParts.push(`<span class="card-badge">${content.type}</span>`);
    meta.innerHTML = metaParts.join('');

    // Handle video
    if (content.video_path) {
        const filename = content.video_path.split('/').pop();
        player.src = `/stream/${filename}`;
        player.load();
    } else {
        player.src = '';
    }

    // Handle episodes for series
    if (content.type === 'series') {
        try {
            const response = await fetch(`/api/content/${content.id}`);
            const fullContent = await response.json();

            if (fullContent.episodes && fullContent.episodes.length > 0) {
                episodesSection.style.display = 'block';
                episodesList.innerHTML = fullContent.episodes.map(ep => `
          <div class="episode-item" onclick="playEpisode('${ep.video_path}')">
            <div class="episode-number">${ep.episode}</div>
            <div class="episode-thumb">
              ${ep.thumbnail ? `<img src="${ep.thumbnail}" alt="Episode ${ep.episode}">` : ''}
            </div>
            <div class="episode-info">
              <h4 class="episode-title">${escapeHtml(ep.title || `Episode ${ep.episode}`)}</h4>
              <p class="episode-desc">${escapeHtml(ep.description || '')}</p>
            </div>
          </div>
        `).join('');
            } else {
                episodesSection.style.display = 'none';
            }
        } catch (error) {
            console.error('Error loading episodes:', error);
            episodesSection.style.display = 'none';
        }
    } else {
        episodesSection.style.display = 'none';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function playEpisode(videoPath) {
    if (!videoPath) return;
    const player = document.getElementById('videoPlayer');
    const filename = videoPath.split('/').pop();
    player.src = `/stream/${filename}`;
    player.load();
    player.play();
    player.scrollIntoView({ behavior: 'smooth' });
}

function closeModal() {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('videoPlayer');

    player.pause();
    player.src = '';
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function setupModalClose() {
    const modal = document.getElementById('videoModal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

// ============ NAVBAR ============
function setupNavbarScroll() {
    const navbar = document.getElementById('navbar');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        lastScroll = currentScroll;
    });
}

// ============ SEARCH ============
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    let debounceTimer;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const query = e.target.value.toLowerCase().trim();

            if (query === '') {
                // Reset to full content
                populateCarousel('recentCarousel', allContent.slice(0, 10));
                populateCarousel('moviesCarousel', allContent.filter(c => c.type === 'movie'));
                populateCarousel('seriesCarousel', allContent.filter(c => c.type === 'series'));
            } else {
                // Filter content
                const filtered = allContent.filter(c =>
                    c.title.toLowerCase().includes(query) ||
                    (c.description && c.description.toLowerCase().includes(query)) ||
                    (c.genre && c.genre.toLowerCase().includes(query))
                );

                populateCarousel('recentCarousel', filtered);
                document.getElementById('moviesSection').style.display = 'none';
                document.getElementById('seriesSection').style.display = 'none';
            }
        }, 300);
    });
}

// ============ UTILITIES ============
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
    <span>${type === 'success' ? '✓' : '✕'}</span>
    <span>${message}</span>
  `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
