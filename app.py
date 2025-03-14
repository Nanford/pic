import os
import uuid
import logging
from datetime import datetime
from logging.handlers import RotatingFileHandler
from flask import Flask, render_template, request, jsonify, send_from_directory, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
import pandas as pd
from PIL import Image as PILImage
import io

# 配置Flask应用
app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# 确保日志目录存在
if not os.path.exists('logs'):
    os.makedirs('logs')

# 配置日志
file_handler = RotatingFileHandler('logs/app.log', maxBytes=10240, backupCount=10)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
))
file_handler.setLevel(logging.INFO)
app.logger.addHandler(file_handler)
app.logger.setLevel(logging.INFO)
app.logger.info('图片上传应用启动')

# 配置数据库连接池
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://pic_user:Lin%cxy@localhost/image_gallery'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_POOL_SIZE'] = 5
app.config['SQLALCHEMY_POOL_RECYCLE'] = 280
app.config['SQLALCHEMY_MAX_OVERFLOW'] = 10

# 配置上传
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['ALLOWED_EXTENSIONS'] = {'png', 'jpg', 'jpeg', 'gif'}
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB
app.config['UPLOAD_TIMEOUT'] = 60  # 60秒超时

# 初始化数据库
db = SQLAlchemy(app)

# 确保上传目录存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# 图片模型
class Image(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False, unique=True)
    original_filename = db.Column(db.String(255), nullable=False)
    upload_date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    filesize = db.Column(db.Integer)
    filetype = db.Column(db.String(50))

    def get_url(self):
        if self.filename:
            return url_for('static', 
                         filename=f'uploads/{self.filename}', 
                         _external=True, 
                         _scheme='https')
        return None

    def get_thumbnail_url(self):
        """获取缩略图URL"""
        return url_for('static', filename=f'uploads/thumbnails/{self.filename}')

    def to_dict(self):
        return {
            'id': self.id,
            'filename': self.filename,
            'original_filename': self.original_filename,
            'url': self.get_url(),
            'thumbnail_url': self.get_thumbnail_url(),
            'filesize': f"{self.filesize / 1024:.1f}KB" if self.filesize else "Unknown",
            'filetype': self.filetype or "Unknown",
            'upload_date': self.upload_date.strftime('%Y-%m-%d %H:%M:%S') if self.upload_date else ""
        }

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    """处理文件上传请求"""
    app.logger.info(f"收到上传请求: {request.remote_addr}")
    
    if 'files[]' not in request.files:
        app.logger.warning('没有文件被上传')
        return jsonify({'error': '没有文件被上传'}), 400
    
    files = request.files.getlist('files[]')
    if not files or files[0].filename == '':
        app.logger.warning('没有选择文件')
        return jsonify({'error': '没有选择文件'}), 400
    
    new_images = []  # 存储图片对象而非字典
    for file in files:
        if file and allowed_file(file.filename):
            try:
                # 生成安全的文件名
                original_filename = secure_filename(file.filename)
                unique_filename = f"{uuid.uuid4().hex}_{original_filename}"
                file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
                
                # 读取文件内容
                file_content = file.read()
                filesize = len(file_content)
                file.seek(0)  # 重置文件指针
                
                # 保存文件
                file.save(file_path)
                
                # 生成缩略图
                create_thumbnail(file_path, unique_filename)
                
                # 检查文件是否成功保存
                if not os.path.exists(file_path):
                    raise Exception(f"文件保存失败")
                
                # 创建数据库记录
                new_image = Image(
                    filename=unique_filename,
                    original_filename=original_filename,
                    filesize=filesize,
                    filetype=file.content_type
                )
                db.session.add(new_image)
                new_images.append(new_image)  # 存储对象引用，而不是立即转换为字典
                app.logger.info(f"文件上传成功: {original_filename}")
                
            except Exception as e:
                app.logger.error(f"处理文件失败: {str(e)}")
                if 'file_path' in locals() and os.path.exists(file_path):
                    os.remove(file_path)
                continue
    
    if not new_images:
        return jsonify({'error': '所有文件上传失败'}), 500
    
    try:
        # 提交事务，让数据库分配ID
        db.session.commit()
        
        # 现在才转换为字典，此时ID已经生成
        uploaded_files = [image.to_dict() for image in new_images]
        
        app.logger.info(f"上传完成，成功: {len(uploaded_files)}张，IP: {request.remote_addr}")
        return jsonify({'files': uploaded_files}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"数据库错误: {str(e)}")
        return jsonify({'error': '数据库错误'}), 500

@app.route('/gallery')
def gallery():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = 18  # 减少每页数量以减轻服务器负担
        format_type = request.args.get('format', 'html')
        
        # 优化查询，只获取需要的字段而不是整个对象
        pagination = Image.query.order_by(Image.upload_date.desc()).paginate(
            page=page, per_page=per_page, error_out=False)
        
        # 仅转换当前页的数据为字典
        image_data = [image.to_dict() for image in pagination.items]
        
        # 如果请求JSON格式，直接返回JSON
        if format_type == 'json':
            return jsonify({
                'images': image_data,
                'page': page,
                'total_pages': pagination.pages,
                'total_images': pagination.total
            })
        
        # 否则返回HTML
        return render_template('gallery.html', 
                             images=image_data,
                             pagination=pagination)
    except Exception as e:
        app.logger.error(f"加载图库时发生错误: {e}")
        
        if format_type == 'json':
            return jsonify({'error': '加载图库失败，请稍后再试'}), 500
            
        return render_template('gallery.html', error='加载图库失败，请稍后再试')

@app.route('/delete_image/<int:image_id>', methods=['DELETE'])
def delete_image(image_id):
    try:
        if not request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'error': '非法请求'}), 400

        image = Image.query.get_or_404(image_id)
        app.logger.info(f"尝试删除图片: ID={image_id}, 文件名={image.filename}")

        # 删除原图
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], image.filename)
        if os.path.exists(file_path):
            os.remove(file_path)
            app.logger.info(f"已删除文件: {file_path}")
        
        # 删除缩略图
        thumbnail_path = os.path.join(app.config['UPLOAD_FOLDER'], 'thumbnails', image.filename)
        if os.path.exists(thumbnail_path):
            os.remove(thumbnail_path)
            app.logger.info(f"已删除缩略图: {thumbnail_path}")

        db.session.delete(image)
        db.session.commit()
        app.logger.info(f"成功从数据库删除图片记录: ID={image_id}")

        return jsonify({'message': '图片已删除', 'success': True}), 200
    
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"删除图片时发生错误: {e}")
        return jsonify({'error': f'删除失败: {str(e)}'}), 500

@app.route('/batch_delete', methods=['POST'])
def batch_delete():
    try:
        ids = request.json.get('ids', [])
        app.logger.info(f"请求批量删除图片，选择的图片ID: {ids}")
        
        if not ids:
            app.logger.warning("未选择任何图片")
            return jsonify({'error': '未选择任何图片'}), 400
        
        deleted_count = 0
        failed_count = 0
        
        for image_id in ids:
            try:
                image = Image.query.get(image_id)
                if not image:
                    continue
                
                # 删除文件
                file_path = os.path.join(app.config['UPLOAD_FOLDER'], image.filename)
                if os.path.exists(file_path):
                    os.remove(file_path)
                    app.logger.info(f"已删除文件: {file_path}")
                else:
                    app.logger.warning(f"文件不存在，无法删除: {file_path}")
                
                db.session.delete(image)
                deleted_count += 1
                
            except Exception as e:
                app.logger.error(f"删除图片ID={image_id}时出错: {e}")
                failed_count += 1
        
        if deleted_count > 0:
            db.session.commit()
            
        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'failed_count': failed_count,
            'message': f'成功删除{deleted_count}张图片' + (f'，{failed_count}张删除失败' if failed_count > 0 else '')
        }), 200
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"批量删除图片时发生错误: {e}")
        return jsonify({'error': f'批量删除失败: {str(e)}'}), 500

@app.route('/download_urls', methods=['POST'])
def download_urls():
    try:
        ids = request.json.get('ids', [])
        app.logger.info(f"请求下载URL表格，选择的图片ID: {ids}")
        
        if not ids:
            app.logger.warning("未选择任何图片")
            return jsonify({'error': '未选择任何图片'}), 400
        
        selected_images = Image.query.filter(Image.id.in_(ids)).all()
        
        if not selected_images:
            app.logger.warning(f"未找到指定ID的图片: {ids}")
            return jsonify({'error': '未找到所选图片'}), 404

        # 创建横向表格数据 - 第一行是文件名，第二行是URL
        filenames = []
        urls = []
        
        for image in selected_images:
            filenames.append(image.original_filename)
            urls.append(image.get_url())
        
        # 创建横向布局的DataFrame
        df = pd.DataFrame([urls], columns=filenames)
        
        excel_filename = f"image_urls_{uuid.uuid4().hex[:6]}.xlsx"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], excel_filename)
        
        # 使用pandas创建Excel文件，index=False移除行索引
        df.to_excel(file_path, index=False)
        
        # 返回可访问的下载链接
        download_url = url_for('static', 
                             filename=f'uploads/{excel_filename}', 
                             _external=True, 
                             _scheme='https')
        
        return jsonify({
            'url': download_url,
            'count': len(selected_images)
        }), 200
        
    except Exception as e:
        app.logger.error(f"生成下载链接时发生错误: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static', 'images'),
                             'favicon.ico', mimetype='image/vnd.microsoft.icon')

# 错误处理
@app.errorhandler(404)
def not_found_error(error):
    app.logger.warning(f"页面不存在: {request.path}")
    return render_template('error.html', error="页面不存在"), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    app.logger.error(f"服务器内部错误: {error}")
    return render_template('error.html', error="服务器内部错误，请稍后再试"), 500

@app.errorhandler(413)
def too_large_error(error):
    app.logger.warning("文件大小超过限制")
    return jsonify({'error': '文件大小超过限制（最大16MB）'}), 413

# CORS支持
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# 在app.py中添加缩略图生成函数
def create_thumbnail(file_path, filename, max_size=(300, 300)):
    """生成质量较高但尺寸优化的缩略图"""
    try:
        # 确保缩略图目录存在
        thumbnail_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'thumbnails')
        os.makedirs(thumbnail_dir, exist_ok=True)
        
        # 生成缩略图文件路径
        thumbnail_path = os.path.join(thumbnail_dir, filename)
        
        # 使用PIL打开图片并生成缩略图
        with PILImage.open(file_path) as img:
            img.thumbnail(max_size, PILImage.LANCZOS)
            
            # 使用更高质量但仍然优化的设置
            if filename.lower().endswith('.jpg') or filename.lower().endswith('.jpeg'):
                img.save(thumbnail_path, format='JPEG', optimize=True, quality=75)
            elif filename.lower().endswith('.png'):
                img.save(thumbnail_path, format='PNG', optimize=True, 
                         compress_level=6)  # 稍微降低压缩级别
            else:
                img.save(thumbnail_path, optimize=True, quality=75)
            
        app.logger.info(f"已生成缩略图: {thumbnail_path}")
        return True
    except Exception as e:
        app.logger.error(f"生成缩略图失败: {str(e)}")
        return False

# 在app.py中修改缓存控制头
@app.after_request
def add_header(response):
    # 静态资源缓存
    if request.path.startswith('/static/css/') or request.path.startswith('/static/js/'):
        # 缓存CSS和JS文件7天
        response.headers['Cache-Control'] = 'public, max-age=604800'
    # 缩略图缓存
    elif request.path.startswith('/static/uploads/thumbnails/'):
        # 缓存缩略图30天
        response.headers['Cache-Control'] = 'public, max-age=2592000'
    # 原图缓存
    elif request.path.startswith('/static/uploads/'):
        # 原图使用长期缓存，但允许验证是否有更新
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    
    # 防止在特定浏览器中的缓存问题
    response.headers['Vary'] = 'Accept-Encoding'
    return response

@app.route('/admin/generate_missing_thumbnails', methods=['GET'])
def generate_missing_thumbnails():
    """为缺少缩略图的图片生成缩略图（仅供管理使用）"""
    try:
        # 获取所有图片
        all_images = Image.query.all()
        total = len(all_images)
        generated = 0
        failed = 0
        
        for image in all_images:
            original_path = os.path.join(app.config['UPLOAD_FOLDER'], image.filename)
            thumbnail_path = os.path.join(app.config['UPLOAD_FOLDER'], 'thumbnails', image.filename)
            
            # 如果原图存在但缩略图不存在
            if os.path.exists(original_path) and not os.path.exists(thumbnail_path):
                if create_thumbnail(original_path, image.filename):
                    generated += 1
                else:
                    failed += 1
        
        return jsonify({
            'success': True,
            'total_images': total,
            'generated': generated,
            'failed': failed
        })
    except Exception as e:
        app.logger.error(f"生成缺失缩略图时出错: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    with app.app_context():
        try:
            db.create_all()
            app.logger.info("数据库表格已创建")
        except Exception as e:
            app.logger.error(f"创建数据库表格时出错: {e}")
    
    app.run(debug=False, host='0.0.0.0', port=5000)