document.addEventListener('DOMContentLoaded', function() {
    logger.debug('DOM加载完成，开始初始化...');
    
    logger.debug('图库页面加载 - 完整URL:', window.location.href);
    
    // 尝试从URL获取selected_ids
    const urlParams = new URLSearchParams(window.location.search);
    const selectedIdsParam = urlParams.get('selected_ids');
    logger.debug('URL参数中的selected_ids:', selectedIdsParam);
    
    // 尝试从sessionStorage获取
    const storedIds = sessionStorage.getItem('lastUploadedImageIds');
    logger.debug('从sessionStorage获取的IDs:', storedIds);
    
    // 查看所有可用的选择器
    logger.debug('检查页面中所有可用的图片选择器:');
    document.querySelectorAll('.image-selector').forEach(selector => {
        logger.debug(`图片选择器ID: ${selector.dataset.id}, 类型: ${typeof selector.dataset.id}`);
    });
    
    // 设置事件处理
    setupImageSelectors();
    setupDeleteButtons();
    setupDownloadButton();
    setupBatchDeleteButton();
    setupImagePreview();
    
    // 尝试选中指定的图片 (整合所有选中逻辑)
    selectSpecifiedImages();

    // 为所有缩略图添加错误处理
    document.querySelectorAll('.preview-image').forEach(img => {
        img.addEventListener('error', function() {
            // 缩略图加载失败时显示占位图
            this.src = '/static/images/thumbnail-error.png';
            this.classList.add('thumbnail-error');
        });
    });
});

// 整合所有选中图片的逻辑到一个函数
function selectSpecifiedImages() {
    // 优先从URL获取
    const urlParams = new URLSearchParams(window.location.search);
    const selectedIdsParam = urlParams.get('selected_ids');
    
    // 如果URL没有，尝试从sessionStorage获取
    const storedIds = sessionStorage.getItem('lastUploadedImageIds');
    
    let imageIds = [];
    
    if (selectedIdsParam && selectedIdsParam.trim()) {
        imageIds = selectedIdsParam.split(',').filter(id => id.trim());
        logger.debug('从URL获取的图片IDs:', imageIds);
    } else if (storedIds) {
        try {
            imageIds = JSON.parse(storedIds);
            sessionStorage.removeItem('lastUploadedImageIds');
            logger.debug('从sessionStorage获取的图片IDs:', imageIds);
        } catch (e) {
            logger.error('解析sessionStorage中的图片IDs失败:', e);
        }
    }
    
    // 如果有指定图片ID，尝试选中它们
    if (imageIds.length > 0) {
        let successCount = 0;
        
        imageIds.forEach(id => {
            // 尝试多种选择器格式
            const selectors = [
                document.querySelector(`.image-selector[data-id="${id}"]`),
                document.querySelector(`.image-selector[data-id='${id}']`),
                !isNaN(id) ? document.querySelector(`.image-selector[data-id="${parseInt(id)}"]`) : null
            ];
            
            const selector = selectors.find(s => s);
            
            if (selector) {
                selector.checked = true;
                updateImageSelection(selector);
                successCount++;
                logger.debug(`成功选中图片ID: ${id}`);
            } else {
                logger.error(`未找到图片ID: ${id} 的选择器`);
            }
        });
        
        logger.debug(`共选中 ${successCount}/${imageIds.length} 张图片`);
        updateDownloadButton();
    }
}

function checkForSelectedImages() {
    // 获取URL中的selected_ids参数
    const urlParams = new URLSearchParams(window.location.search);
    const selectedIds = urlParams.get('selected_ids');
    
    logger.debug('当前URL参数:', window.location.search);
    logger.debug('解析到的selected_ids:', selectedIds);
    
    if (selectedIds) {
        const ids = selectedIds.split(',');
        logger.debug('URL中指定要选中的图片ID:', ids);
        
        // 检查页面中是否存在这些ID的元素
        ids.forEach(id => {
            const checkbox = document.querySelector(`.image-selector[data-id="${id}"]`);
            logger.debug(`查找图片ID ${id} 的选择器:`, checkbox);
            
            if (checkbox) {
                checkbox.checked = true;
                updateImageSelection(checkbox);
                logger.debug(`已选中图片 ${id}`);
            } else {
                logger.error(`未找到图片 ${id} 的选择器`);
            }
        });
        
        // 更新下载按钮状态
        updateDownloadButton();
        
        // 可选：滚动到第一个选中的图片
        const firstSelectedCard = document.querySelector(`.image-selector[data-id="${ids[0]}"]`);
        if (firstSelectedCard) {
            const cardElement = firstSelectedCard.closest('.card');
            if (cardElement) {
                cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
}

function setupImageSelectors() {
    const selectAllBtn = document.getElementById('select-all-btn');
    const imageSelectors = document.querySelectorAll('.image-selector');
    
    logger.debug('找到的元素:', {
        selectAllBtn: !!selectAllBtn,
        imageSelectors: imageSelectors.length
    });

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logger.debug('全选按钮被点击');
            const isSelectAll = this.textContent.trim() === '全选';
            imageSelectors.forEach(checkbox => {
                checkbox.checked = isSelectAll;
                updateImageSelection(checkbox);
            });
            this.textContent = isSelectAll ? '取消全选' : '全选';
            updateDownloadButton();
        });
    }

    imageSelectors.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            logger.debug('图片选择状态改变:', this.checked);
            updateImageSelection(this);
            updateDownloadButton();
        });
    });
}

function setupDeleteButtons() {
    document.querySelectorAll('.delete-image').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            logger.debug('删除按钮被点击');
            const imageId = this.dataset.id;
            if (confirm('确定要删除这张图片吗？此操作不可恢复。')) {
                deleteImage(imageId, this);
            }
        });
    });
}

function setupDownloadButton() {
    const downloadBtn = document.getElementById('download-urls-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logger.debug('下载按钮被点击');
            downloadSelectedUrls();
        });
    }
}

function setupBatchDeleteButton() {
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', function(e) {
            e.preventDefault();
            logger.debug('批量删除按钮被点击');
            batchDeleteImages();
        });
    }
}

function setupImagePreview() {
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalSpinner = document.getElementById('modalSpinner');
    const modalTitle = document.querySelector('#imageModal .modal-title');
    
    if (!modal) return;
    
    const bsModal = new bootstrap.Modal(modal);
    
    document.querySelectorAll('.preview-image').forEach(img => {
        img.addEventListener('click', function() {
            const fullImage = this.dataset.fullImage;
            const fileName = this.alt || '图片预览';
            
            // 更新模态框标题
            if (modalTitle) {
                modalTitle.textContent = fileName;
            }
            
            // 显示加载中状态
            if (modalSpinner) modalSpinner.classList.remove('d-none');
            if (modalImage) {
                modalImage.classList.add('d-none');
                modalImage.src = '';
            }
            
            bsModal.show();
            
            // 直接加载，不延迟
            const fullSizeImg = new Image();
            
            fullSizeImg.onload = function() {
                if (modalImage) {
                    modalImage.src = fullImage;
                    modalImage.classList.remove('d-none');
                }
                if (modalSpinner) modalSpinner.classList.add('d-none');
            };
            
            fullSizeImg.onerror = function() {
                // 加载失败处理
                if (modalSpinner) modalSpinner.classList.add('d-none');
                if (modalImage) {
                    modalImage.src = '/static/images/error.png'; // 替换为错误图片
                    modalImage.classList.remove('d-none');
                }
                logger.error('加载原图失败:', fullImage);
            };
            
            fullSizeImg.src = fullImage;
        });
    });
}

function updateImageSelection(checkbox) {
    const card = checkbox.closest('.card');
    if (card) {
        if (checkbox.checked) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    }
}

function updateDownloadButton() {
    const downloadBtn = document.getElementById('download-urls-btn');
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    
    const checkedCount = document.querySelectorAll('.image-selector:checked').length;
    logger.debug('已选择图片数量:', checkedCount, '下载按钮:', !!downloadBtn, '批量删除按钮:', !!batchDeleteBtn);
    
    if (downloadBtn) {
        downloadBtn.disabled = checkedCount === 0;
    }
    
    if (batchDeleteBtn) {
        batchDeleteBtn.disabled = checkedCount === 0;
    }
}

function deleteImage(imageId, button) {
    const card = button.closest('.col-md-3');
    logger.debug('正在删除图片:', imageId);

    // 显示加载中状态
    showLoading();

    fetch(`/delete_image/${imageId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        hideLoading();
        if (data.error) {
            throw new Error(data.error);
        }
        
        // 删除成功后从DOM中移除元素
        card.classList.add('fade-out');
        setTimeout(() => {
            card.remove();
        }, 500);
    })
    .catch(error => {
        hideLoading();
        logger.error('删除错误:', error);
        alert('删除失败: ' + error.message);
    });
}

function batchDeleteImages() {
    const selectedCheckboxes = document.querySelectorAll('.image-selector:checked');
    const selectedIds = Array.from(selectedCheckboxes).map(checkbox => checkbox.dataset.id);
    
    if (selectedIds.length === 0) {
        alert('请先选择要删除的图片');
        return;
    }
    
    if (confirm(`确定要删除选中的 ${selectedIds.length} 张图片吗？此操作不可恢复。`)) {
        // 显示加载中状态
        showLoading();
        
        fetch('/batch_delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ ids: selectedIds })
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            alert(data.message);
            
            // 刷新页面以显示更新后的图片列表
            location.reload();
        })
        .catch(error => {
            hideLoading();
            logger.error('批量删除失败:', error);
            alert('批量删除失败: ' + error.message);
        });
    }
}

function downloadSelectedUrls() {
    const selectedImages = document.querySelectorAll('.image-selector:checked');
    const ids = Array.from(selectedImages).map(checkbox => checkbox.dataset.id);
    
    if (ids.length === 0) {
        alert('请先选择要下载的图片');
        return;
    }
    
    // 显示下载模态框
    const downloadModal = new bootstrap.Modal(document.getElementById('downloadModal'));
    downloadModal.show();
    
    fetch('/download_urls', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ ids: ids })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('网络响应不正常');
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }
        
        downloadModal.hide();
        
        // 确保使用 HTTPS URL
        const downloadUrl = data.url.replace('http:', 'https:');
        logger.debug('下载URL:', downloadUrl);
        
        // 创建下载链接
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = 'image_urls.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    })
    .catch(error => {
        downloadModal.hide();
        logger.error('下载失败:', error);
        alert('下载失败: ' + error.message);
    });
}

// 显示加载中状态
function showLoading() {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id = 'loadingOverlay';
    overlay.innerHTML = `
        <div class="loading-content">
            <div class="spinner-border text-primary mb-2" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <div>处理中...</div>
        </div>
    `;
    document.body.appendChild(overlay);
}

// 隐藏加载中状态
function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.remove();
    }
}

// 错误处理函数
function handleError(error) {
    logger.error('操作失败:', error);
    alert('操作失败: ' + (error.message || '未知错误'));
}