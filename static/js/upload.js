document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('upload-form');
    const uploadButton = document.getElementById('upload-button');
    const buttonText = uploadButton.querySelector('.button-text');
    const spinner = uploadButton.querySelector('.spinner-border');
    const uploadResults = document.getElementById('upload-results');
    const resultList = document.getElementById('result-list');
    const fileInput = document.getElementById('file-input');
    const dropzone = document.getElementById('dropzone');
    const previewContainer = document.getElementById('preview-container');
    const copyAllUrlsBtn = document.getElementById('copy-all-urls');
    
    let filesToUpload = new DataTransfer();

    // 阻止默认拖放行为
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, function(e) {
            e.preventDefault();
            e.stopPropagation();
        }, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // 添加高亮效果
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropzone.classList.add('active');
    }

    function unhighlight(e) {
        dropzone.classList.remove('active');
    }

    // 处理拖放文件
    dropzone.addEventListener('drop', function(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    });

    // 处理文件选择
    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    // 点击区域也能触发文件选择
    dropzone.addEventListener('click', function(e) {
        if (e.target === dropzone || e.target.closest('.placeholder')) {
            fileInput.click();
        }
    });

    function handleFiles(files) {
        // 筛选出图片文件
        const imageFiles = Array.from(files).filter(file => 
            file.type.startsWith('image/') && 
            file.size <= 16 * 1024 * 1024
        );
        
        if (imageFiles.length === 0) {
            alert('请选择有效的图片文件（JPG、PNG、GIF 等），且不超过 16MB');
            return;
        }
        
        // 添加新文件到待上传列表
        imageFiles.forEach(file => {
            filesToUpload.items.add(file);
        });
        
        // 更新预览区域
        updatePreview();
    }

    function updatePreview() {
        previewContainer.innerHTML = '';
        
        if (filesToUpload.files.length > 0) {
            previewContainer.classList.remove('d-none');
            
            Array.from(filesToUpload.files).forEach((file, index) => {
                const reader = new FileReader();
                
                reader.onload = function(e) {
                    const col = document.createElement('div');
                    col.className = 'col-md-3 col-sm-4 col-6';
                    
                    col.innerHTML = `
                        <div class="image-preview">
                            <img src="${e.target.result}" alt="${file.name}">
                            <div class="remove-image" data-index="${index}">
                                <i class="bi bi-x"></i>
                            </div>
                            <div class="image-name" title="${file.name}">${file.name}</div>
                        </div>
                    `;
                    
                    previewContainer.appendChild(col);
                    
                    // 添加删除事件
                    col.querySelector('.remove-image').addEventListener('click', function() {
                        const newFiles = new DataTransfer();
                        const removeIndex = parseInt(this.dataset.index);
                        
                        Array.from(filesToUpload.files)
                            .filter((_, i) => i !== removeIndex)
                            .forEach(file => newFiles.items.add(file));
                        
                        filesToUpload = newFiles;
                        updatePreview();
                    });
                };
                
                reader.readAsDataURL(file);
            });
        } else {
            previewContainer.classList.add('d-none');
        }
    }

    // 上传表单提交
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (filesToUpload.files.length === 0) {
            alert('请选择至少一张图片上传');
            return;
        }
        
        // 显示加载状态
        buttonText.textContent = '上传中...';
        spinner.classList.remove('d-none');
        uploadButton.disabled = true;
        
        const formData = new FormData();
        Array.from(filesToUpload.files).forEach(file => {
            formData.append('files[]', file);
        });
        
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            // 更详细的响应检查
            logger.debug('上传响应状态:', response.status);
            if (!response.ok) {
                // 尝试读取响应内容
                return response.text().then(text => {
                    logger.error('服务器响应内容:', text);
                    throw new Error(`服务器响应异常 (${response.status})`);
                });
            }
            
            // 尝试解析JSON
            return response.json().catch(e => {
                logger.error('JSON解析错误:', e);
                throw new Error('响应格式异常');
            });
        })
        .then(data => {
            logger.debug('上传返回的完整数据:', data);
            
            // 检查文件ID是否存在
            let hasValidIds = false;
            if (data.files && data.files.length > 0) {
                data.files.forEach((file, index) => {
                    logger.debug(`文件${index}:`, file);
                    if (file.id) {
                        hasValidIds = true;
                        logger.debug(`文件${index} ID有效:`, file.id);
                    } else {
                        logger.warn(`文件${index} ID无效:`, file.id);
                        if (file.filename) {
                            file.id = file.filename.replace(/\.[^/.]+$/, "");
                            logger.debug(`为文件${index}生成ID:`, file.id);
                            hasValidIds = true;
                        }
                    }
                });
            }
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            // 清空之前的结果
            resultList.innerHTML = '';
            
            // 添加每个上传的文件到结果表格
            data.files.forEach(file => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${file.filename}</td>
                    <td>
                        <div class="d-flex align-items-center">
                            <a href="${file.url}" target="_blank" class="me-2 text-truncate" style="max-width: 250px;">${file.url}</a>
                            <i class="bi bi-clipboard copy-url" data-url="${file.url}" title="复制链接"></i>
                        </div>
                    </td>
                    <td>
                        <button type="button" class="btn btn-sm btn-outline-danger delete-image" data-id="${file.id}">删除</button>
                    </td>
                `;
                resultList.appendChild(row);
            });
            
            // 显示结果
            uploadResults.classList.remove('d-none');
            
            // 在替换gallery-link前增加断点检查
            logger.debug('准备处理gallery-link元素');
            logger.debug('当前gallery-link元素:', document.getElementById('gallery-link'));
            
            // 设置gallery-link
            const galleryLink = document.getElementById('gallery-link');
            if (galleryLink && data.files && data.files.length > 0 && hasValidIds) {
                const imageIds = data.files
                    .map(file => file.id || file.filename?.replace(/\.[^/.]+$/, ""))
                    .filter(id => id);
                
                if (imageIds.length > 0) {
                    galleryLink.href = `/gallery?selected_ids=${imageIds.join(',')}&t=${Date.now()}`;
                    logger.debug('已设置图库链接:', galleryLink.href);
                }
            } else {
                logger.error('未找到gallery-link元素或上传数据无效');
            }
            
            // 重置表单和预览
            filesToUpload = new DataTransfer();
            updatePreview();
            fileInput.value = ''; // 清空文件输入框
            
            // 设置复制和删除功能
            setupCopyButtons();
            setupDeleteButtons();
        })
        .catch(error => {
            logger.error('上传过程中发生错误:', error);
            
            // 添加重要处理: 检查图片是否已经上传成功
            // 尝试请求最新的图库数据
            fetch('/gallery?format=json')
            .then(response => response.json())
            .then(galleryData => {
                if (galleryData.images && galleryData.images.length > 0) {
                    const recentImages = galleryData.images.slice(0, 5); // 获取最近5张图片
                    const confirmMessage = `上传过程中出现网络异常，但图片可能已经上传成功。\n\n要查看最近上传的图片吗？`;
                    
                    if (confirm(confirmMessage)) {
                        window.location.href = '/gallery';
                        return;
                    }
                }
                // 如果用户不选择查看或没有最近图片，则显示错误
                alert('上传失败: ' + error.message);
            })
            .catch(() => {
                // 如果检查失败，仍然显示原始错误
                alert('上传失败: ' + error.message);
            });
        })
        .finally(() => {
            // 恢复按钮状态
            buttonText.textContent = '上传图片';
            spinner.classList.add('d-none');
            uploadButton.disabled = false;
        });
    });

    function setupCopyButtons() {
        document.querySelectorAll('.copy-url').forEach(button => {
            button.addEventListener('click', function() {
                const url = this.dataset.url;
                navigator.clipboard.writeText(url).then(() => {
                    this.classList.remove('bi-clipboard');
                    this.classList.add('bi-clipboard-check');
                    setTimeout(() => {
                        this.classList.remove('bi-clipboard-check');
                        this.classList.add('bi-clipboard');
                    }, 2000);
                });
            });
        });
    }

    // 复制全部URL
    copyAllUrlsBtn.addEventListener('click', function() {
        const urls = Array.from(document.querySelectorAll('.copy-url'))
            .map(el => el.dataset.url)
            .join('\n');
        
        if (urls) {
            navigator.clipboard.writeText(urls).then(() => {
                const originalText = this.textContent;
                this.textContent = '已复制！';
                setTimeout(() => {
                    this.textContent = originalText;
                }, 2000);
            });
        }
    });

    function setupDeleteButtons() {
        document.querySelectorAll('.delete-image').forEach(button => {
            button.addEventListener('click', function() {
                const imageId = this.dataset.id;
                const row = this.closest('tr');
                
                if (confirm('确定要删除这张图片吗？此操作不可恢复。')) {
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
                        
                        // 动画效果删除行
                        row.style.transition = 'opacity 0.5s ease';
                        row.style.opacity = '0';
                        setTimeout(() => {
                            row.remove();
                            if (resultList.children.length === 0) {
                                uploadResults.classList.add('d-none');
                            }
                        }, 500);
                    })
                    .catch(error => {
                        hideLoading();
                        logger.error('删除错误:', error);
                        alert('删除失败: ' + error.message);
                    });
                }
            });
        });
    }

    // 显示加载中状态
    function showLoading() {
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-content">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="mt-2">处理中...</div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    // 隐藏加载中状态
    function hideLoading() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    // 为文件输入框添加错误处理
    fileInput.addEventListener('error', function(e) {
        logger.error('文件输入错误:', e);
        alert('文件处理出错，请重试');
    });
});
